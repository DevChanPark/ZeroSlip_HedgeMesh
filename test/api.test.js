import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, openSync, closeSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import { createRequestHandler } from "../src/server/app.js";

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
  const handler = createRequestHandler({ prisma, now: () => NOW });

  try {
    const shortIntent = await invokeJson(handler, "POST", "/api/intents", {
      intentId: "api_short_mnt_10000",
      user: "0xA000000000000000000000000000000000000001",
      asset: "MNT",
      direction: "SHORT",
      notionalUsd: 10000,
      durationMinutes: 60,
      maxCostBps: 30,
      urgency: "MEDIUM"
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
      urgency: "MEDIUM"
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

    const event = await invokeJson(handler, "POST", "/api/chain-events", {
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
    });
    assert.equal(event.status, 201);

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
