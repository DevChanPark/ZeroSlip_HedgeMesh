# DoraHacks Submission Draft

## Project Name

ZeroSlip HedgeMesh

## One-liner

ZeroSlip HedgeMesh is an AI-assisted hedge intent netting layer on Mantle that
matches opposite hedge demand internally before routing only residual exposure
to external liquidity.

## Short Description

Crypto traders, LPs, market makers, and autonomous trading agents constantly
hedge risk. When each participant hedges independently through external
liquidity, they repeatedly pay spread, slippage, fees, gas, market impact, and
execution-delay risk.

ZeroSlip HedgeMesh reduces this hedge drag by collecting structured hedge
intents, matching compatible opposite demand internally, and calculating how
much residual exposure still needs external routing. The MVP records intent,
match, and agent-decision logs on Mantle Sepolia while keeping matching math
deterministic and auditable.

## Track Fit

- Main track: AI Trading & Strategy
- Secondary angle: Agentic Wallets & Economy
- Chain: Mantle Sepolia

## What We Built

- Natural-language hedge intent parser with structured form fallback.
- Prisma-backed intent book and match history.
- Deterministic matching engine with self-match, expiry, asset, direction, and
  duration constraints.
- Cost comparison engine showing naive external execution vs HedgeMesh netting.
- Residual hedge simulator.
- Agent decision explanation layer with optional OpenAI structured output and
  deterministic fallback.
- Mantle Sepolia `IntentBook` contract for submitted hedge-intent logs.
- Mantle Sepolia `MatchLog` contract for match and agent-decision logs.
- Judge-facing dashboard with internal match rate, external liquidity avoided,
  residual exposure, saved cost, and recent tx hashes.

## Mantle Sepolia Contracts

- IntentBook: `0x7489039281b77aab0ef24f56e333f28cfc352ee9`
- MatchLog: `0xc02797d86f47ac6757383039b4bb5c2d9fe4e3cc`
- Explorer: `https://explorer.sepolia.mantle.xyz`

## Golden Demo Result

```text
SHORT MNT hedge demand: $10,000
LONG MNT hedge demand:  $7,000
Internal match:          $7,000
Residual hedge:          $3,000 SHORT
Internal match rate:     70%
External liquidity avoided: $14,000
Saved cost:              about 19 bps
```

## Why It Matters

ZeroSlip HedgeMesh is not a volume farming bot, arbitrage bot, or full
derivatives exchange. It is infrastructure for legitimate risk management. The
core insight is that many hedge flows are naturally offsetting, so the cheapest
hedge is often the one that never needs to hit external liquidity in the first
place.

## Repo

`https://github.com/DevChanPark/ZeroSlip_HedgeMesh`

## Demo Runbook

```bash
npm run db:init
npm run demo:reset
npm run api
```

Open `http://127.0.0.1:3001`, connect the Mantle Sepolia operator wallet,
submit the default `$10,000 SHORT MNT` hedge intent, run matching, then log the
decision to Mantle.

## MVP Boundaries

This hackathon MVP proves the hedge intent netting layer and transparent
Mantle logging. It does not implement production margin, liquidation, insurance
funds, oracle disputes, or real-money settlement.
