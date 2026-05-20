# API Draft

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
  "asset": "MNT",
  "internalMatchUsd": 7000,
  "residualDirection": "SHORT",
  "residualUsd": 3000,
  "internalMatchRate": 0.7,
  "decision": "MATCH"
}
```

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

