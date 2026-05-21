import { readFile } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";

import { reconcileMantleSepoliaIntents, repairMantleSepoliaIntents } from "./chain-state.js";
import { syncMantleSepoliaEvents } from "./chain-sync.js";
import {
  buildCostComparison,
  cancelHedgeIntent,
  createHedgeIntent,
  explainAgentDecision,
  expireHedgeIntents,
  getDashboard,
  getDecision,
  getMatch,
  listChainEvents,
  listIntents,
  listMatches,
  parseIntentText,
  recordChainEvent,
  runMatching
} from "./hedge-service.js";

const PUBLIC_DIR = path.resolve(process.cwd(), "public");

export function createRequestHandler({
  prisma,
  now = () => Date.now(),
  reconcileIntents = reconcileMantleSepoliaIntents,
  repairIntents = repairMantleSepoliaIntents,
  syncChainEvents = syncMantleSepoliaEvents
}) {
  return async function handleRequest(req, res) {
    try {
      const url = new URL(req.url, "http://localhost");

      if (req.method === "OPTIONS") {
        return sendEmpty(res, 204);
      }

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        return sendStatic(res, path.join(PUBLIC_DIR, "index.html"));
      }

      if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
        const assetPath = decodeURIComponent(url.pathname.slice("/assets/".length));
        if (assetPath.includes("..") || path.isAbsolute(assetPath)) {
          return sendJson(res, 400, { errors: ["invalid asset path"] });
        }
        return sendStatic(res, path.join(PUBLIC_DIR, "assets", assetPath));
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === "POST" && url.pathname === "/api/intent/parse") {
        const body = await readJson(req);
        return sendJson(res, 200, await parseIntentText(body.text));
      }

      if (req.method === "POST" && url.pathname === "/api/intents") {
        const body = await readJson(req);
        const result = await createHedgeIntent(prisma, body, { now: now() });
        return sendJson(res, result.status, result.ok ? result.intent : { errors: result.errors });
      }

      if (req.method === "GET" && url.pathname === "/api/intents") {
        const result = await listIntents(prisma, {
          asset: url.searchParams.get("asset")
        });
        return sendJson(res, 200, result);
      }

      if (req.method === "POST" && url.pathname === "/api/intents/expire") {
        const body = await readJson(req);
        const result = await expireHedgeIntents(prisma, body, { now: now() });
        return sendJson(
          res,
          result.status,
          result.ok
            ? { expiredCount: result.expiredCount, intents: result.intents }
            : { errors: result.errors }
        );
      }

      if (req.method === "POST" && url.pathname === "/api/intents/reconcile") {
        const body = await readJson(req);
        const result = await reconcileIntents(prisma, body, { now: now() });
        return sendJson(res, result.status, result.ok ? result : { errors: result.errors });
      }

      if (req.method === "POST" && url.pathname === "/api/intents/reconcile/apply") {
        const body = await readJson(req);
        const result = await repairIntents(prisma, body, { now: now() });
        return sendJson(res, result.status, result.ok ? result : { errors: result.errors });
      }

      if (
        req.method === "POST" &&
        url.pathname.startsWith("/api/intents/") &&
        url.pathname.endsWith("/cancel")
      ) {
        const body = await readJson(req);
        const intentId = decodeURIComponent(url.pathname.split("/").at(-2));
        const result = await cancelHedgeIntent(prisma, intentId, body);
        return sendJson(res, result.status, result.ok ? result.intent : { errors: result.errors });
      }

      if (req.method === "GET" && url.pathname === "/api/dashboard") {
        const result = await getDashboard(
          prisma,
          {
            asset: url.searchParams.get("asset"),
            network: url.searchParams.get("network")
          },
          { now: now() }
        );
        return sendJson(res, 200, result);
      }

      if (req.method === "GET" && url.pathname === "/api/matches") {
        const result = await listMatches(prisma, {
          asset: url.searchParams.get("asset"),
          limit: url.searchParams.get("limit")
        });
        return sendJson(res, 200, result);
      }

      if (req.method === "GET" && url.pathname.startsWith("/api/matches/")) {
        const matchId = decodeURIComponent(url.pathname.split("/").pop());
        const match = await getMatch(prisma, matchId);
        return match
          ? sendJson(res, 200, match)
          : sendJson(res, 404, { errors: ["match not found"] });
      }

      if (req.method === "POST" && url.pathname === "/api/matching/run") {
        const body = await readJson(req);
        const result = await runMatching(prisma, body, { now: now() });
        return sendJson(
          res,
          result.status,
          result.ok
            ? {
                matchResult: result.matchResult,
                costComparison: result.costComparison,
                decision: result.decision
              }
            : { errors: result.errors }
        );
      }

      if (req.method === "POST" && url.pathname === "/api/cost/compare") {
        const body = await readJson(req);
        const result = buildCostComparison(body);
        return sendJson(
          res,
          result.status,
          result.ok ? result.costComparison : { errors: result.errors }
        );
      }

      if (req.method === "GET" && url.pathname.startsWith("/api/decisions/")) {
        const decisionId = decodeURIComponent(url.pathname.split("/").pop());
        const decision = await getDecision(prisma, decisionId);
        return decision
          ? sendJson(res, 200, decision)
          : sendJson(res, 404, { errors: ["decision not found"] });
      }

      if (req.method === "POST" && url.pathname === "/api/decision/explain") {
        const body = await readJson(req);
        const result = await explainAgentDecision(body, { now: now() });
        return sendJson(res, result.status, result.ok ? result.decision : { errors: result.errors });
      }

      if (req.method === "POST" && url.pathname === "/api/chain-events") {
        const body = await readJson(req);
        const result = await recordChainEvent(prisma, body, { now: now() });
        return sendJson(res, result.status, result.ok ? result.event : { errors: result.errors });
      }

      if (req.method === "POST" && url.pathname === "/api/chain-events/sync") {
        const body = await readJson(req);
        const result = await syncChainEvents(prisma, body, { now: now() });
        return sendJson(res, result.status, result.ok ? result : { errors: result.errors });
      }

      if (req.method === "GET" && url.pathname === "/api/chain-events") {
        const result = await listChainEvents(prisma, {
          network: url.searchParams.get("network"),
          contractName: url.searchParams.get("contractName"),
          limit: url.searchParams.get("limit")
        });
        return sendJson(res, 200, result);
      }

      return sendJson(res, 404, { errors: ["route not found"] });
    } catch (error) {
      const status = error.statusCode ?? 500;
      return sendJson(res, status, { errors: [error.message] });
    }
  };
}

async function sendStatic(res, filePath) {
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": contentType(filePath),
      "content-length": body.byteLength
    });
    res.end(body);
  } catch (error) {
    if (error.code === "ENOENT") {
      return sendJson(res, 404, { errors: ["asset not found"] });
    }
    throw error;
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "access-control-allow-origin": "*"
  });
  res.end(body);
}

function sendEmpty(res, status) {
  res.writeHead(status, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end();
}

function contentType(filePath) {
  const extension = path.extname(filePath);
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}
