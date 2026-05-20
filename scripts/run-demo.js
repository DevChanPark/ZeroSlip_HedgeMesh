import { compareCosts } from "../src/core/cost.js";
import { buildAgentDecision } from "../src/core/decision.js";
import { matchIntents } from "../src/core/matching.js";
import { parseNaturalLanguageIntent } from "../src/core/parser.js";
import { buildDemoIntents } from "../src/core/sample-data.js";

const now = Date.parse("2026-05-20T00:00:00.000Z");
const parsed = parseNaturalLanguageIntent(
  "나 MNT 1,000달러 하락 리스크를 1시간만 막고 싶어. 비용은 10bps 이하."
);
const intents = buildDemoIntents(now);
const matchResult = matchIntents(intents, { asset: "MNT", now });
const costComparison = compareCosts(matchResult);
const decision = buildAgentDecision({
  asset: "MNT",
  matchResult,
  costComparison,
  urgency: "MEDIUM",
  maxCostBps: 30
});

console.log(
  JSON.stringify(
    {
      parsedIntentExample: parsed,
      matchResult,
      costComparison,
      decision
    },
    null,
    2
  )
);

