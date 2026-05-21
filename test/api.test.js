import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, openSync, closeSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import { createRequestHandler } from "../src/server/app.js";
import { syncMantleSepoliaEvents } from "../src/server/chain-sync.js";

const NOW = Date.parse("2026-05-20T00:00:00.000Z");

class MockRequest extends Readable {
  constructor(method, url, payload) {
    super();
    this.method = method;
    this.url = url;
    this.payload = payload;
  }

  _read() {
    if (this.payload !== undefined) {
      this.push(Buffer.from(this.payload));
      this.payload = undefined;
    } else {
      this.push(null);
    }
  }
}

class MockResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 200;
    this.body = "";
  }

  writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    this.headers = headers;
  }

  _write(chunk, _encoding, callback) {
    this.body += chunk.toString("utf8");
    callback();
  }

  end(chunk) {
    if (chunk) this.body += chunk.toString("utf8");
    super.end();
  }
}

test("HTTP API persists intents, matches them, and returns decision state", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "zeroslip-api-"));
  const dbFileName = `api-test-${process.pid}-${Date.now()}.db`;
  const dbPath = path.join(process.cwd(), "prisma", dbFileName);
  closeSync(openSync(dbPath, "w"));
  const databaseUrl = `file:./${dbFileName}`;

  const migrationSql = readFileSync(
    path.join(process.cwd(), "prisma/migrations/20260520092117_init/migration.sql"),
    "utf8"
  );
  execFileSync("sqlite3", [dbPath], { input: migrationSql, stdio: ["pipe", "ignore", "ignore"] });

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl
      }
    }
  });
  const syncCalls = [];
  const handler = createRequestHandler({
    prisma,
    now: () => NOW,
    syncChainEvents: async (_prisma, body, options) => {
      syncCalls.push({ body, options });
      return {
        ok: true,
        status: 200,
        network: body.network ?? "mantle-sepolia",
        fromBlock: Number(body.fromBlock ?? 0),
        toBlock: Number(body.toBlock ?? 0),
        syncedCount: 1,
        duplicateCount: 0,
        events: []
      };
    }
  });

  try {
    const shortIntent = await invokeJson(handler, "POST", "/api/intents", {
      intentId: "api_short_mnt_10000",
      user: "0xA000000000000000000000000000000000000001",
      asset: "MNT",
      direction: "SHORT",
      notionalUsd: 10000,
      durationMinutes: 60,
      maxCostBps: 30,
      urgency: "MEDIUM",
      onchainIntentId: "0xshort"
    });
    assert.equal(shortIntent.status, 201, JSON.stringify(shortIntent.body));
    assert.equal(shortIntent.body.status, "OPEN");

    await invokeJson(handler, "POST", "/api/intents", {
      intentId: "api_long_mnt_7000",
      user: "0xB000000000000000000000000000000000000002",
      asset: "MNT",
      direction: "LONG",
      notionalUsd: 7000,
      durationMinutes: 60,
      maxCostBps: 30,
      urgency: "MEDIUM",
      onchainIntentId: "0xlong"
    });

    const book = await invokeJson(handler, "GET", "/api/intents?asset=MNT");
    assert.equal(book.status, 200);
    assert.equal(book.body.shortDemandUsd, 10000);
    assert.equal(book.body.longDemandUsd, 7000);

    const match = await invokeJson(handler, "POST", "/api/matching/run", {
      asset: "MNT",
      matchId: "api_match_mnt",
      decisionId: "api_decision_mnt",
      maxCostBps: 30,
      urgency: "MEDIUM"
    });

    assert.equal(match.status, 201);
    assert.equal(match.body.matchResult.matchedNotionalUsd, 7000);
    assert.equal(match.body.matchResult.residualDirection, "SHORT");
    assert.equal(match.body.costComparison.externalLiquidityAvoidedUsd, 14000);
    assert.equal(match.body.decision.decisionType, "MATCH");
    assert.equal(match.body.matchResult.allocations[0].shortOnchainIntentId, "0xshort");
    assert.equal(match.body.matchResult.allocations[0].longOnchainIntentId, "0xlong");

    const matches = await invokeJson(handler, "GET", "/api/matches?asset=MNT");
    assert.equal(matches.status, 200);
    assert.equal(matches.body.matches.length, 1);
    assert.equal(matches.body.matches[0].matchId, "api_match_mnt");
    assert.equal(matches.body.matches[0].allocations[0].shortOnchainIntentId, "0xshort");

    const matchDetail = await invokeJson(handler, "GET", "/api/matches/api_match_mnt");
    assert.equal(matchDetail.status, 200);
    assert.equal(matchDetail.body.allocations[0].longOnchainIntentId, "0xlong");

    const persistedShort = await prisma.hedgeIntent.findUniqueOrThrow({
      where: { id: "api_short_mnt_10000" }
    });
    const persistedLong = await prisma.hedgeIntent.findUniqueOrThrow({
      where: { id: "api_long_mnt_7000" }
    });
    assert.equal(Number(persistedShort.filledNotionalUsd), 7000);
    assert.equal(persistedShort.status, "PARTIALLY_MATCHED");
    assert.equal(Number(persistedLong.filledNotionalUsd), 7000);
    assert.equal(persistedLong.status, "MATCHED");

    const decision = await invokeJson(handler, "GET", "/api/decisions/api_decision_mnt");
    assert.equal(decision.status, 200);
    assert.equal(decision.body.decisionType, "MATCH");
    assert.equal(decision.body.matchId, "api_match_mnt");

    const hedgeMatchedEventBody = {
      network: "mantle-sepolia",
      chainId: 5003,
      contractName: "MatchLog",
      contractAddress: "0xc02797d86f47ac6757383039b4bb5c2d9fe4e3cc",
      eventName: "HedgeMatched",
      txHash: "0x0000000000000000000000000000000000000000000000000000000000000abc",
      blockNumber: 38900480,
      matchId: "api_match_mnt",
      onchainId: "0xmatch",
      payload: {
        asset: "MNT",
        matchedNotionalUsd: "7000",
        residualNotionalUsd: "3000",
        estimatedSavingsBps: "19"
      }
    };
    const event = await invokeJson(handler, "POST", "/api/chain-events", hedgeMatchedEventBody);
    assert.equal(event.status, 201);

    const duplicateEvent = await invokeJson(handler, "POST", "/api/chain-events", hedgeMatchedEventBody);
    assert.equal(duplicateEvent.status, 200);
    assert.equal(duplicateEvent.body.duplicate, true);

    const dashboard = await invokeJson(handler, "GET", "/api/dashboard?asset=MNT");
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.totals.intentCount, 2);
    assert.equal(dashboard.body.totals.activeIntentCount, 1);
    assert.equal(dashboard.body.totals.matchCount, 1);
    assert.equal(dashboard.body.totals.successfulMatchCount, 1);
    assert.equal(dashboard.body.totals.decisionCount, 1);
    assert.equal(dashboard.body.totals.chainEventCount, 1);
    assert.equal(dashboard.body.totals.matchedNotionalUsd, 7000);
    assert.equal(dashboard.body.totals.residualNotionalUsd, 3000);
    assert.equal(dashboard.body.totals.historicalResidualNotionalUsd, 3000);
    assert.equal(dashboard.body.totals.internalMatchRate, 0.7);
    assert.equal(dashboard.body.totals.externalLiquidityAvoidedUsd, 14000);
    assert.equal(dashboard.body.latestMatch.matchId, "api_match_mnt");
    assert.equal(dashboard.body.latestDecision.decisionId, "api_decision_mnt");
    assert.equal(dashboard.body.recentEvents[0].eventName, "HedgeMatched");

    const sync = await invokeJson(handler, "POST", "/api/chain-events/sync", {
      network: "mantle-sepolia",
      fromBlock: 38900476,
      toBlock: 38900481
    });
    assert.equal(sync.status, 200);
    assert.equal(sync.body.syncedCount, 1);
    assert.equal(syncCalls.length, 1);
    assert.equal(syncCalls[0].body.fromBlock, 38900476);
    assert.equal(syncCalls[0].options.now, NOW);

    const rpcSync = await syncMantleSepoliaEvents(
      prisma,
      {
        network: "mantle-sepolia",
        contractName: "IntentBook",
        fromBlock: 38900481,
        toBlock: 38900481
      },
      {
        now: NOW,
        client: {
          getLogs: async ({ event }) =>
            event.name === "HedgeIntentMatched"
              ? [
                  {
                    transactionHash:
                      "0x0000000000000000000000000000000000000000000000000000000000000123",
                    blockNumber: 38900481n,
                    logIndex: 0,
                    args: {
                      intentId: "0xshort",
                      user: "0xA000000000000000000000000000000000000001",
                      matchedNotionalUsd: 7000n,
                      filledNotionalUsd: 7000n,
                      status: 1n
                    }
                  }
                ]
              : []
        }
      }
    );
    assert.equal(rpcSync.status, 200);
    assert.equal(rpcSync.syncedCount, 1);
    assert.equal(rpcSync.events[0].eventName, "HedgeIntentMatched");

    const fillEvent = await invokeJson(handler, "POST", "/api/chain-events", {
      network: "mantle-sepolia",
      chainId: 5003,
      contractName: "IntentBook",
      contractAddress: "0x7489039281b77aab0ef24f56e333f28cfc352ee9",
      eventName: "HedgeIntentMatched",
      txHash: "0x0000000000000000000000000000000000000000000000000000000000000def",
      blockNumber: 38900481,
      intentId: "api_short_mnt_10000",
      onchainId: "0xshort",
      payload: {
        intentId: "0xshort",
        user: "0xA000000000000000000000000000000000000001",
        matchedNotionalUsd: "7000",
        filledNotionalUsd: "7000",
        status: "1"
      }
    });
    assert.equal(fillEvent.status, 201);

    const syncedShort = await prisma.hedgeIntent.findUniqueOrThrow({
      where: { id: "api_short_mnt_10000" }
    });
    assert.equal(Number(syncedShort.filledNotionalUsd), 7000);
    assert.equal(syncedShort.status, "PARTIALLY_MATCHED");

    await invokeJson(handler, "POST", "/api/intents", {
      intentId: "api_cancel_meth",
      user: "0xC000000000000000000000000000000000000003",
      asset: "mETH",
      direction: "SHORT",
      notionalUsd: 500,
      durationMinutes: 60,
      maxCostBps: 20,
      urgency: "LOW"
    });
    const cancelled = await invokeJson(handler, "POST", "/api/intents/api_cancel_meth/cancel", {
      user: "0xC000000000000000000000000000000000000003"
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.status, "CANCELLED");

    const cancelledBook = await invokeJson(handler, "GET", "/api/intents?asset=mETH");
    assert.equal(cancelledBook.status, 200);
    assert.equal(cancelledBook.body.shortDemandUsd, 0);

    await prisma.hedgeIntent.create({
      data: {
        id: "api_expired_usdc",
        walletAddress: "0xD000000000000000000000000000000000000004",
        asset: "USDC",
        direction: "LONG",
        notionalUsd: 500,
        durationMinutes: 1,
        maxCostBps: 10,
        urgency: "LOW",
        status: "OPEN",
        filledNotionalUsd: 0,
        createdAt: new Date(NOW - 120_000),
        expiresAt: new Date(NOW - 60_000)
      }
    });

    const expired = await invokeJson(handler, "POST", "/api/intents/expire", {
      asset: "USDC"
    });
    assert.equal(expired.status, 200);
    assert.equal(expired.body.expiredCount, 1);
    assert.equal(expired.body.intents[0].status, "EXPIRED");

    const expiredIntent = await prisma.hedgeIntent.findUniqueOrThrow({
      where: { id: "api_expired_usdc" }
    });
    assert.equal(expiredIntent.status, "EXPIRED");
  } finally {
    await prisma.$disconnect();
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-journal`, { force: true });
    rmSync(tempDir, { recursive: true, force: true });
  }
});

async function invokeJson(handler, method, pathName, body) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const req = new MockRequest(method, pathName, payload);
  const res = new MockResponse();

  await handler(req, res);

  return {
    status: res.statusCode,
    body: res.body ? JSON.parse(res.body) : null
  };
}
