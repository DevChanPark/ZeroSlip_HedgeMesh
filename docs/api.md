# API Draft

The current local API is implemented with Node's built-in HTTP server and
Prisma-backed SQLite persistence. Run it with:

```bash
npm run api
```

Default local URL:

```text
http://127.0.0.1:3001
```

The Next.js web console runs on `http://127.0.0.1:3000` and proxies `/api/*`
to this backend.

## GET /health

Response:

```json
{
  "ok": true
}
```

## POST /api/intent/parse

Parse natural language into a structured hedge intent.

Request:

```json
{
  "text": "나 MNT 1000달러 하락 리스크 1시간만 막고 싶어. 비용은 10bps 이하."
}
```

Response:

```json
{
  "asset": "MNT",
  "direction": "SHORT",
  "notionalUsd": 1000,
  "durationMinutes": 60,
  "maxCostBps": 10,
  "urgency": "MEDIUM",
  "confidence": 0.92
}
```

## POST /api/intents

Create an intent.

Request:

```json
{
  "user": "0x123",
  "asset": "MNT",
  "direction": "SHORT",
  "notionalUsd": 1000,
  "durationMinutes": 60,
  "maxCostBps": 10,
  "urgency": "MEDIUM"
}
```

Response:

```json
{
  "intentId": "intent_001",
  "status": "OPEN"
}
```

The API persists the intent into the `HedgeIntent` table.

## GET /api/intents?asset=MNT

Return intent book summary.

```json
{
  "asset": "MNT",
  "shortDemandUsd": 10000,
  "longDemandUsd": 7000,
  "intents": []
}
```

## GET /api/dashboard?asset=MNT

Return DB-backed KPI totals for the web console. The response is designed to
survive page reloads because it is derived from persisted intents, matches,
decisions, and chain events.

Response:

```json
{
  "asset": "MNT",
  "totals": {
    "intentCount": 2,
    "activeIntentCount": 1,
    "matchCount": 1,
    "successfulMatchCount": 1,
    "decisionCount": 1,
    "chainEventCount": 3,
    "matchedNotionalUsd": 7000,
    "residualNotionalUsd": 3000,
    "internalMatchRate": 0.7,
    "naiveExternalVolumeUsd": 17000,
    "meshExternalVolumeUsd": 3000,
    "externalLiquidityAvoidedUsd": 14000,
    "avgSavedCostBps": 19.4,
    "savedCostUsd": 32.98
  },
  "latestMatch": {},
  "latestDecision": {},
  "recentEvents": []
}
```

## POST /api/matching/run

Run deterministic matching for an asset.

Request:

```json
{
  "asset": "MNT"
}
```

Response:

```json
{
  "matchResult": {
    "asset": "MNT",
    "matchedNotionalUsd": 7000,
    "residualDirection": "SHORT",
    "residualNotionalUsd": 3000,
    "internalMatchRate": 0.7
  },
  "costComparison": {
    "naiveExternalVolumeUsd": 17000,
    "meshExternalVolumeUsd": 3000,
    "externalLiquidityAvoidedUsd": 14000,
    "naiveCostBps": 26,
    "meshCostBps": 6.6,
    "savedCostBps": 19.4
  },
  "decision": {
    "decisionType": "MATCH"
  }
}
```

The API persists:

- `HedgeMatch`
- `MatchAllocation`
- updated `HedgeIntent.filledNotionalUsd` and `HedgeIntent.status`
- `AgentDecision`

## POST /api/cost/compare

Compare naive hedge cost and HedgeMesh cost.

Request:

```json
{
  "asset": "MNT",
  "shortDemandUsd": 10000,
  "longDemandUsd": 7000,
  "internalMatchUsd": 7000,
  "residualUsd": 3000
}
```

Response:

```json
{
  "naiveExternalVolumeUsd": 17000,
  "meshExternalVolumeUsd": 3000,
  "externalLiquidityAvoidedUsd": 14000,
  "naiveCostBps": 26,
  "meshCostBps": 7,
  "savedCostBps": 19
}
```

## POST /api/decision/explain

Return structured decision explanation.

Response:

```json
{
  "decisionType": "MATCH",
  "reason": "The agent matched $7,000 of opposite MNT hedge intents internally because both sides shared the same asset, compatible duration, and cost constraints. Only $3,000 residual short hedge needs external liquidity.",
  "risks": [
    "Residual short demand remains unmatched",
    "External hedge cost may change before execution"
  ]
}
```

## GET /api/decisions/:decisionId

Read a persisted agent decision.

Response:

```json
{
  "decisionId": "decision_001",
  "decisionType": "MATCH",
  "asset": "MNT",
  "internalMatchUsd": 7000,
  "residualUsd": 3000,
  "reason": "Matched $7,000 of opposite MNT hedge intents internally.",
  "risks": [
    "Residual hedge exposure remains unmatched"
  ],
  "recommendedAction": "Log match and simulate residual route",
  "matchId": "match_001"
}
```
