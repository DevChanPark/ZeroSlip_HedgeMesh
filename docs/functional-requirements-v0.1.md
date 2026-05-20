# ZeroSlip HedgeMesh Functional Requirements v0.1

## 1. Project Overview

ZeroSlip HedgeMesh is an AI-powered hedge intent netting layer on Mantle. It
matches opposite hedge intents from traders and AI agents internally, then routes
only residual exposure to external liquidity.

The MVP is a prototype that proves hedge-intent netting and cost reduction. It
is not a full derivatives exchange.

## 2. Users

- Trader User: submits hedge intent to reduce directional portfolio risk.
- AI Trading Agent: submits automated hedge intent from strategy state.
- Dashboard Viewer / Judge: evaluates why the system matters and how much cost
  it saves.
- Operator / Developer: seeds demo data, runs matching, and verifies on-chain
  logs.

## 3. Core Use Cases

### UC-01 Natural-language intent creation

Input:

```text
나 MNT 1,000달러어치 하락 리스크를 1시간만 막고 싶어.
헷지 비용은 10bps 넘으면 안 돼.
```

Parsed intent:

```json
{
  "asset": "MNT",
  "direction": "SHORT",
  "notionalUsd": 1000,
  "durationMinutes": 60,
  "maxCostBps": 10,
  "urgency": "MEDIUM"
}
```

### UC-02 Opposite intent netting

```text
SHORT demand: $10,000
LONG demand:  $7,000

Internal match: $7,000
Residual:       $3,000 SHORT
```

### UC-03 Cost comparison

Naive execution routes all hedge demand externally. HedgeMesh routes only the
residual hedge externally.

```text
Naive external volume:    $17,000
HedgeMesh external volume: $3,000
External liquidity avoided: $14,000
```

### UC-04 Residual route decision

If no compatible opposite demand exists, the system classifies the unmatched
amount as residual exposure. The decision layer chooses WAIT, ROUTE_EXTERNAL, or
REJECT based on urgency, estimated external cost, and maxCostBps.

## 4. P0 Functional Requirements

### Wallet

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-001 | Connect EVM wallet | P0 |
| FR-002 | Check Mantle network | P0 |
| FR-003 | Request Mantle network switch | P1 |
| FR-004 | Display wallet address | P1 |

### Hedge Intent Input

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-101 | Natural-language hedge input | P0 |
| FR-102 | Structured intent form | P0 |
| FR-103 | Parse text into JSON intent | P0 |
| FR-104 | Validate required fields and supported assets | P0 |
| FR-105 | Preview parsed intent before submit | P0 |
| FR-106 | Submit validated intent | P0 |

Supported MVP assets: MNT, USDC, mETH.

### IntentBook

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-201 | Store submitted hedge intents | P0 |
| FR-202 | Query by asset and direction | P0 |
| FR-203 | Manage OPEN, PARTIALLY_MATCHED, MATCHED, CANCELLED, EXPIRED | P0 |
| FR-204 | Cancel own OPEN intent | P1 |
| FR-205 | Exclude expired intents from matching | P0 |
| FR-206 | Prevent same-wallet self-match | P0 |

### Matching Engine

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-301 | Group intents by asset | P0 |
| FR-302 | Split LONG and SHORT demand | P0 |
| FR-303 | Check duration compatibility | P0 |
| FR-304 | Check cost constraints | P0 |
| FR-305 | Calculate internal match amount | P0 |
| FR-306 | Support partial matching | P1 |
| FR-307 | Calculate residual exposure | P0 |
| FR-308 | Generate matching explanation inputs | P0 |

Compatibility rules:

```text
same asset
opposite direction
duration within +/- 15 minutes
not expired
different wallet
supported asset
non-negative maxCostBps
```

### Cost Comparison

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-401 | Calculate naive external hedge cost | P0 |
| FR-402 | Calculate HedgeMesh cost | P0 |
| FR-403 | Calculate saved bps | P0 |
| FR-404 | Calculate external liquidity avoided | P0 |
| FR-405 | Display bps cost | P0 |
| FR-406 | Display USD cost | P1 |

### AI Decision Layer

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-601 | Return MATCH, WAIT, ROUTE_EXTERNAL, or REJECT | P0 |
| FR-602 | Explain decision in natural language | P0 |
| FR-603 | Include risk warnings | P0 |
| FR-604 | Return structured JSON | P0 |
| FR-605 | Keep calculations deterministic outside the LLM | P0 |

### On-chain Logging

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-701 | Emit HedgeIntentSubmitted | P0 |
| FR-702 | Emit HedgeMatched | P0 |
| FR-703 | Emit AgentDecisionLogged | P0 |
| FR-704 | Display tx hash | P0 |
| FR-705 | Link Mantle explorer | P1 |

### Dashboard

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-801 | Show asset-level LONG/SHORT demand | P0 |
| FR-802 | Show internal match rate | P0 |
| FR-803 | Show external liquidity avoided | P0 |
| FR-804 | Compare naive cost and HedgeMesh cost | P0 |
| FR-805 | Show agent decision and reason | P0 |
| FR-806 | Show residual hedge amount and route label | P0 |
| FR-807 | Show recent events and tx hashes | P0 |

## 5. Data Models

```ts
type HedgeIntent = {
  intentId: string;
  user: string;
  asset: "MNT" | "mETH" | "USDC";
  direction: "LONG" | "SHORT";
  notionalUsd: number;
  durationMinutes: number;
  maxCostBps: number;
  urgency: "LOW" | "MEDIUM" | "HIGH";
  status: "OPEN" | "PARTIALLY_MATCHED" | "MATCHED" | "CANCELLED" | "EXPIRED";
  filledNotionalUsd: number;
  createdAt: number;
  expiresAt: number;
};

type MatchResult = {
  matchId: string;
  asset: string;
  longIntentIds: string[];
  shortIntentIds: string[];
  matchedNotionalUsd: number;
  residualDirection: "LONG" | "SHORT" | "NONE";
  residualNotionalUsd: number;
  entryPrice: number;
  estimatedInternalCostBps: number;
  estimatedExternalCostBps: number;
  estimatedSavingsBps: number;
  createdAt: number;
};

type CostComparison = {
  asset: string;
  naiveExternalVolumeUsd: number;
  meshExternalVolumeUsd: number;
  externalLiquidityAvoidedUsd: number;
  naiveCostBps: number;
  meshCostBps: number;
  savedCostBps: number;
  savedCostUsd: number;
};

type AgentDecision = {
  decisionId: string;
  decisionType: "MATCH" | "WAIT" | "ROUTE_EXTERNAL" | "REJECT";
  asset: string;
  internalMatchUsd: number;
  residualUsd: number;
  reason: string;
  risks: string[];
  createdAt: number;
  txHash?: string;
};
```

## 6. Security Requirements

| ID | Requirement |
| --- | --- |
| SEC-001 | Prevent self-match from the same wallet |
| SEC-002 | Exclude expired intents |
| SEC-003 | Reject unsupported assets |
| SEC-004 | Block external route when maxCostBps is exceeded |
| SEC-005 | Log decisions transparently on-chain |
| SEC-006 | Use cost-reduction KPIs, not volume incentives |
| SEC-007 | Keep MVP simulation-first |

## 7. Non-functional Requirements

| ID | Requirement |
| --- | --- |
| NFR-001 | Matching result within 3 seconds |
| NFR-002 | Judges understand the value prop within 1 minute |
| NFR-003 | Same input produces same matching result |
| NFR-004 | Every intent, match, and decision has a unique ID |
| NFR-005 | Manual form fallback when parser confidence is low |
| NFR-006 | User-friendly tx error and retry handling |
| NFR-007 | Easy to add assets |
| NFR-008 | Contract permissions separated |

## 8. Demo KPIs

```text
Internal Match Rate
External Liquidity Avoided
Naive Hedge Cost
HedgeMesh Cost
Saved Cost in bps / USD
Residual Exposure
Number of Matched Intents
Number of Rejected Bad Hedges
On-chain Logged Decisions
```

