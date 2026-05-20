import { URL } from "node:url";

import {
  buildCostComparison,
  createHedgeIntent,
  getDecision,
  listIntents,
  parseIntentText,
  runMatching
} from "./hedge-service.js";

export function createRequestHandler({ prisma, now = () => Date.now() }) {
  return async function handleRequest(req, res) {
    try {
      const url = new URL(req.url, "http://localhost");

      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === "POST" && url.pathname === "/api/intent/parse") {
        const body = await readJson(req);
        return sendJson(res, 200, parseIntentText(body.text));
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

      return sendJson(res, 404, { errors: ["route not found"] });
    } catch (error) {
      const status = error.statusCode ?? 500;
      return sendJson(res, status, { errors: [error.message] });
    }
  };
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

