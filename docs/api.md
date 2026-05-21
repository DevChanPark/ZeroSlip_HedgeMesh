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
If `OPENAI_API_KEY` is configured, the API first asks the AI layer for a strict
JSON schema response. If AI is unavailable or the output fails validation, the
deterministic local parser is used as a fallback.

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
  "confidence": 0.92,
  "aiSource": "openai"
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

## POST /api/intents/:intentId/cancel

Cancel an active intent in the database after the owner signs the cancellation
flow. The web console calls the Mantle Sepolia `cancelIntent(bytes32)` contract
function first when the intent has an `onchainIntentId`, then persists the
status transition here.

Request:

```json
{
  "user": "0x123"
}
```

Response:

```json
{
  "intentId": "intent_001",
  "status": "CANCELLED"
}
```

## POST /api/intents/expire

Mark stale active intents as expired. Matching already excludes expired intents
by timestamp; this endpoint updates their persisted status so the intent book is
operationally clear.

Request:

```json
{
  "asset": "MNT"
}
```

Response:

```json
{
  "expiredCount": 1,
  "intents": [
    {
      "intentId": "intent_001",
      "status": "EXPIRED"
    }
  ]
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

## POST /api/intents/reconcile

Compare local `HedgeIntent` rows with the deployed Mantle Sepolia `IntentBook`
mapping. This is a read-only operational check: it does not mutate the DB or
send a transaction.

Request:

```json
{
  "network": "mantle-sepolia",
  "asset": "MNT",
  "limit": 40
}
```

Response:

```json
{
  "network": "mantle-sepolia",
  "contractAddress": "0x7489...",
  "asset": "MNT",
  "summary": {
    "total": 2,
    "withOnchainId": 2,
    "checked": 2,
    "consistent": 2,
    "mismatched": 0,
    "localOnly": 0,
    "readFailed": 0
  },
  "intents": [
    {
      "intentId": "intent_MNT_...",
      "onchainIntentId": "0x...",
      "consistent": true,
      "differences": []
    }
  ]
}
```

The comparison checks owner, asset, direction, notional, duration, max cost,
urgency, filled amount, and status. Block timestamps are returned for context
but are not treated as hard mismatches because DB creation time is recorded
after the transaction receipt.

## POST /api/intents/reconcile/apply

Apply an operational DB cleanup based on the reconciliation result. This never
sends an on-chain transaction; it only updates local DB rows so the backend does
not keep matching stale local/demo state.

Request:

```json
{
  "network": "mantle-sepolia",
  "asset": "MNT",
  "action": "ARCHIVE_LOCAL_ONLY"
}
```

Supported actions:

- `ARCHIVE_LOCAL_ONLY`: set intents with no `onchainIntentId` to `LOCAL_ONLY`
  so they are excluded from matching.
- `APPLY_CHAIN_STATE`: copy on-chain `status`, `filledNotionalUsd`, and
  `expiresAt` into DB rows that have an on-chain intent id.
- `APPLY_ALL`: run both of the above.

Response:

```json
{
  "action": "ARCHIVE_LOCAL_ONLY",
  "updatedCount": 2,
  "updates": [],
  "reconciliation": {
    "summary": {
      "mismatched": 0,
      "localOnly": 2
    }
  }
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
    "historicalResidualNotionalUsd": 3000,
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

## GET /api/matches?asset=MNT

Return persisted match history with allocation details and on-chain intent ids.
The web console uses this endpoint through the dashboard path so a page reload
does not lose the latest allocation context required for `Sync Fills`.

Response:

```json
{
  "matches": [
    {
      "matchId": "match_001",
      "asset": "MNT",
      "allocations": [
        {
          "shortIntentId": "intent_short",
          "longIntentId": "intent_long",
          "matchedUsd": 7000,
          "shortOnchainIntentId": "0x...",
          "longOnchainIntentId": "0x..."
        }
      ]
    }
  ]
}
```

## GET /api/matches/:matchId

Return one persisted match with allocations and related decisions.

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
    "allocations": [
      {
        "shortIntentId": "intent_short",
        "longIntentId": "intent_long",
        "matchedUsd": 7000,
        "shortOnchainIntentId": "0x...",
        "longOnchainIntentId": "0x..."
      }
    ],
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

The web console uses allocation `onchainIntentId` values to call
`IntentBook.markIntentMatched(bytes32,uint256)` and then records the resulting
`HedgeIntentMatched` event through `/api/chain-events`.

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
The matching and cost math stay deterministic; AI is only allowed to rewrite the
human-readable explanation, risks, and recommended action. If `OPENAI_API_KEY`
is not configured, the deterministic explanation is returned.

Response:

```json
{
  "decisionType": "MATCH",
  "reason": "The agent matched $7,000 of opposite MNT hedge intents internally because both sides shared the same asset, compatible duration, and cost constraints. Only $3,000 residual short hedge needs external liquidity.",
  "risks": [
    "Residual short demand remains unmatched",
    "External hedge cost may change before execution"
  ],
  "recommendedAction": "Log match and simulate residual route",
  "aiSource": "openai"
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

## POST /api/chain-events/sync

Read deployed Mantle Sepolia contract logs from RPC and reconcile them into the
local `ChainEvent` table. This is the recovery path for events that happened
on-chain but were not persisted because the browser was refreshed or an API
request failed after the transaction was mined.

Request:

```json
{
  "network": "mantle-sepolia",
  "contractName": "IntentBook",
  "fromBlock": 38900476,
  "toBlock": "latest"
}
```

`contractName`, `fromBlock`, and `toBlock` are optional. If `fromBlock` is
omitted, the API starts from the latest stored event with a small reorg buffer,
or from the deployment block recorded in `deployments/mantle-sepolia.json`.

Response:

```json
{
  "network": "mantle-sepolia",
  "fromBlock": 38900476,
  "toBlock": 38901000,
  "syncedCount": 3,
  "duplicateCount": 1,
  "events": []
}
```

The sync is idempotent: repeating it over the same block range marks existing
rows as duplicates instead of creating extra chain-event records.
