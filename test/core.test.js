import assert from "node:assert/strict";
import test from "node:test";

import { compareCosts } from "../src/core/cost.js";
import { buildAgentDecision } from "../src/core/decision.js";
import { matchIntents } from "../src/core/matching.js";
import { createIntent } from "../src/core/model.js";
import { parseNaturalLanguageIntent } from "../src/core/parser.js";
import { buildDemoIntents } from "../src/core/sample-data.js";
import {
  buildAgentDecisionWithAiFallback,
  parseIntentWithAiFallback
} from "../src/server/ai-service.js";

const NOW = Date.parse("2026-05-20T00:00:00.000Z");

test("parses Korean natural-language hedge intent into a structured draft", () => {
  const parsed = parseNaturalLanguageIntent(
    "나 MNT 1,000달러어치 하락 리스크를 1시간만 막고 싶어. 헷지 비용은 10bps 넘으면 안 돼."
  );

  assert.equal(parsed.asset, "MNT");
  assert.equal(parsed.direction, "SHORT");
  assert.equal(parsed.notionalUsd, 1000);
  assert.equal(parsed.durationMinutes, 60);
  assert.equal(parsed.maxCostBps, 10);
  assert.equal(parsed.urgency, "MEDIUM");
  assert.equal(parsed.requiresManualReview, false);
});

test("matches opposite MNT hedge demand and leaves only short residual", () => {
  const result = matchIntents(buildDemoIntents(NOW), { asset: "MNT", now: NOW });

  assert.equal(result.totalShortUsd, 10_000);
  assert.equal(result.totalLongUsd, 7_000);
  assert.equal(result.matchedNotionalUsd, 7_000);
  assert.equal(result.residualDirection, "SHORT");
  assert.equal(result.residualShortUsd, 3_000);
  assert.equal(result.residualLongUsd, 0);
  assert.equal(result.meshExternalVolumeUsd, 3_000);
  assert.equal(result.internalMatchRate, 0.7);
  assert.deepEqual(result.allocations, [
    {
      shortIntentId: "intent_short_mnt_10000",
      longIntentId: "intent_long_mnt_7000",
      asset: "MNT",
      matchedUsd: 7_000
    }
  ]);
});

test("prevents same-wallet self-match even when directions offset", () => {
  const intents = [
    createIntent(
      {
        user: "0xA000000000000000000000000000000000000001",
        asset: "MNT",
        direction: "SHORT",
        notionalUsd: 1000,
        durationMinutes: 60,
        maxCostBps: 20,
        urgency: "MEDIUM"
      },
      { intentId: "same_short", createdAt: NOW, expiresAt: NOW + 60 * 60_000 }
    ),
    createIntent(
      {
        user: "0xA000000000000000000000000000000000000001",
        asset: "MNT",
        direction: "LONG",
        notionalUsd: 1000,
        durationMinutes: 60,
        maxCostBps: 20,
        urgency: "MEDIUM"
      },
      { intentId: "same_long", createdAt: NOW, expiresAt: NOW + 60 * 60_000 }
    )
  ];

  const result = matchIntents(intents, { asset: "MNT", now: NOW });

  assert.equal(result.matchedNotionalUsd, 0);
  assert.equal(result.residualDirection, "MIXED");
  assert.equal(result.meshExternalVolumeUsd, 2000);
});

test("excludes expired intents from matching", () => {
  const expired = createIntent(
    {
      user: "0xA000000000000000000000000000000000000001",
      asset: "MNT",
      direction: "SHORT",
      notionalUsd: 1000,
      durationMinutes: 60,
      maxCostBps: 20,
      urgency: "MEDIUM"
    },
    { intentId: "expired_short", createdAt: NOW - 120 * 60_000, expiresAt: NOW - 60_000 }
  );

  const active = createIntent(
    {
      user: "0xB000000000000000000000000000000000000002",
      asset: "MNT",
      direction: "LONG",
      notionalUsd: 1000,
      durationMinutes: 60,
      maxCostBps: 20,
      urgency: "MEDIUM"
    },
    { intentId: "active_long", createdAt: NOW, expiresAt: NOW + 60 * 60_000 }
  );

  const result = matchIntents([expired, active], { asset: "MNT", now: NOW });

  assert.equal(result.totalShortUsd, 0);
  assert.equal(result.totalLongUsd, 1000);
  assert.equal(result.matchedNotionalUsd, 0);
});

test("compares naive external cost with HedgeMesh residual route cost", () => {
  const matchResult = matchIntents(buildDemoIntents(NOW), { asset: "MNT", now: NOW });
  const cost = compareCosts(matchResult);

  assert.equal(cost.naiveExternalVolumeUsd, 17_000);
  assert.equal(cost.meshExternalVolumeUsd, 3_000);
  assert.equal(cost.externalLiquidityAvoidedUsd, 14_000);
  assert.equal(cost.naiveCostBps, 26);
  assert.equal(cost.meshCostBps, 6.6);
  assert.equal(cost.savedCostBps, 19.4);
});

test("builds structured MATCH decision explanation from deterministic outputs", () => {
  const matchResult = matchIntents(buildDemoIntents(NOW), { asset: "MNT", now: NOW });
  const costComparison = compareCosts(matchResult);
  const decision = buildAgentDecision({
    asset: "MNT",
    matchResult,
    costComparison,
    maxCostBps: 30,
    urgency: "MEDIUM"
  });

  assert.equal(decision.decisionType, "MATCH");
  assert.equal(decision.internalMatchUsd, 7000);
  assert.equal(decision.residualUsd, 3000);
  assert.match(decision.reason, /Matched \$7,000/);
  assert.ok(decision.risks.includes("Residual hedge exposure remains unmatched"));
});

test("uses structured AI parser output when an OpenAI client is configured", async () => {
  const parsed = await parseIntentWithAiFallback("대충 MNT 하락 방어", {
    apiKey: "test-key",
    fetch: async () =>
      jsonResponse({
        output_text: JSON.stringify({
          asset: "MNT",
          direction: "SHORT",
          notionalUsd: 2500,
          durationMinutes: 120,
          maxCostBps: 9,
          urgency: "HIGH",
          confidence: 0.93,
          requiresManualReview: false,
          errors: []
        })
      })
  });

  assert.equal(parsed.aiSource, "openai");
  assert.equal(parsed.asset, "MNT");
  assert.equal(parsed.direction, "SHORT");
  assert.equal(parsed.notionalUsd, 2500);
  assert.equal(parsed.durationMinutes, 120);
  assert.equal(parsed.maxCostBps, 9);
  assert.equal(parsed.urgency, "HIGH");
  assert.equal(parsed.requiresManualReview, false);
});

test("falls back to deterministic parsing when OpenAI is not configured", async () => {
  const parsed = await parseIntentWithAiFallback(
    "나 MNT 1,000달러 하락 리스크를 1시간 막고 싶어. 비용은 10bps 이하."
  );

  assert.equal(parsed.aiSource, "deterministic");
  assert.equal(parsed.asset, "MNT");
  assert.equal(parsed.direction, "SHORT");
});

test("redacts OpenAI errors before returning fallback output", async () => {
  const parsed = await parseIntentWithAiFallback(
    "나 MNT 1,000달러 하락 리스크를 1시간 막고 싶어. 비용은 10bps 이하.",
    {
      apiKey: "test-key",
      fetch: async () =>
        jsonResponse(
          {
            error: {
              message: "Incorrect API key provided: sk-proj-secret"
            }
          },
          401
        )
    }
  );

  assert.equal(parsed.aiSource, "deterministic");
  assert.equal(parsed.aiError, "OpenAI request failed; deterministic fallback used");
  assert.doesNotMatch(parsed.aiError, /sk-/);
});

test("uses AI wording without changing deterministic decision math", async () => {
  const matchResult = matchIntents(buildDemoIntents(NOW), { asset: "MNT", now: NOW });
  const costComparison = compareCosts(matchResult);
  const decision = await buildAgentDecisionWithAiFallback(
    {
      asset: "MNT",
      matchResult,
      costComparison,
      maxCostBps: 30,
      urgency: "MEDIUM"
    },
    {
      apiKey: "test-key",
      now: NOW,
      fetch: async () =>
        jsonResponse({
          output_text: JSON.stringify({
            summary: "Matched opposite MNT hedge demand internally.",
            reason: "AI wording: the deterministic engine matched compatible opposite intents and reduced residual external routing.",
            risks: ["Residual short exposure remains"],
            recommendedAction: "Log match and simulate residual route"
          })
        })
    }
  );

  assert.equal(decision.aiSource, "openai");
  assert.equal(decision.decisionType, "MATCH");
  assert.equal(decision.internalMatchUsd, 7000);
  assert.equal(decision.residualUsd, 3000);
  assert.match(decision.reason, /AI wording/);
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  };
}
