# ZeroSlip HedgeMesh

AI-powered hedge intent netting layer on Mantle.

ZeroSlip HedgeMesh is not a volume farming bot or a traditional arbitrage bot.
It reduces hedge drag by matching opposite hedge intents internally before
routing only residual exposure to external liquidity.

## Hackathon Positioning

- Main track: AI Trading & Strategy
- Secondary angle: Agentic Wallets & Economy
- Chain target: Mantle Sepolia for MVP logging

## MVP Thesis

Crypto traders, LPs, market makers, and AI trading agents hedge risk constantly.
If every participant hedges independently through external DEX/CEX liquidity,
they repeatedly pay slippage, spread, trading fees, gas, funding cost, and
execution-delay risk.

HedgeMesh first nets compatible opposite hedge intent:

```text
MNT SHORT hedge demand: $10,000
MNT LONG hedge demand:  $7,000

Internal match:         $7,000
Residual external:      $3,000 SHORT
External liquidity avoided vs naive execution: $14,000
```

The MVP proves the netting layer and cost-saving effect. It is not a
production derivatives exchange, liquidation engine, or real-money settlement
system.

## Core Flow

```text
Natural language hedge input
-> intent parser
-> structured HedgeIntent
-> IntentBook event
-> deterministic matching engine
-> residual hedge calculation
-> naive cost vs HedgeMesh cost comparison
-> agent decision explanation
-> MatchLog / AgentDecisionLogged event
-> dashboard metrics
```

## Repository Structure

```text
contracts/       Solidity contract skeletons for intent and decision logging
docs/            Product requirements, architecture, API, and demo notes
scripts/         Local demo runners
src/core/        Deterministic matching, cost, parser, and decision logic
test/            Node test runner coverage for MVP logic
```

## Local Engine Demo

This initial scaffold has no external runtime dependencies.

```bash
npm test
npm run demo
```

The demo validates the core claim: opposite hedge demand can be internally
matched, residual exposure can be calculated, and the avoided external liquidity
can be shown in bps and USD terms.

## MVP Scope

P0:

- Wallet connect and Mantle network check
- Natural-language hedge intent input with structured form fallback
- IntentBook contract events
- Off-chain deterministic matching engine
- Cost comparison engine
- Residual hedge simulator
- Agent decision explanation
- On-chain event log display
- Dashboard for match rate, avoided liquidity, and saved cost

Out of scope for hackathon MVP:

- Full perpetual exchange
- Production margin and liquidation system
- Insurance fund
- Oracle dispute system
- Real-money synthetic settlement

