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
src/server/      Prisma-backed API, AI fallback, and chain reconciliation
app/             Next.js web console for the judge-facing demo
test/            Node test runner coverage for MVP logic
```

## Submission Demo

For the Mantle wallet demo path, reset the local database into a predictable
state with one seeded counterparty intent:

```bash
npm run db:init
npm run demo:reset
```

Then run the API and web console in separate terminals:

```bash
npm run api
npm run web
```

Open `http://127.0.0.1:3000`, connect the operator wallet on Mantle Sepolia,
and submit the default `$10,000 SHORT MNT` hedge intent. The reset script
already seeded a `$7,000 LONG MNT` counterparty, so pressing `Run Matching`
produces the golden KPI:

```text
Internal match: $7,000
Residual hedge: $3,000 SHORT
Internal match rate: 70%
External liquidity avoided: $14,000
Saved cost: about 19 bps
```

Use `Sync Fills` to update the submitted on-chain intent status, then
`Log Decision` to write the match and agent decision to Mantle Sepolia.

If Next.js local build/dev startup is slow, use the static one-process console
served by the API instead:

```bash
npm run api
```

Then open `http://127.0.0.1:3001`. This fallback console covers the same submit,
match, KPI, and decision-log story without requiring the Next.js dev server.

For a no-wallet rehearsal of the same KPI, use:

```bash
npm run demo:reset:golden
npm run demo:db
```

## Local Engine Demo

```bash
nvm install
nvm use
npm install
npm run db:generate
npm run db:init
npm run demo:reset:golden
npm test
npm run demo
npm run demo:db
```

The demo validates the core claim: opposite hedge demand can be internally
matched, residual exposure can be calculated, and the avoided external liquidity
can be shown in bps and USD terms.

`npm run demo` exercises the deterministic core in memory. `npm run demo:db`
reads seeded intents from SQLite through Prisma, persists the match, allocation,
and agent decision records, and proves the same flow with real database state.

## Mantle Sepolia

```bash
npm run compile
npm run chain:check
```

Deployment requires a Mantle Sepolia-funded private key in `.env`.

```bash
npm run deploy:mantle-sepolia
```

See [docs/deployment.md](docs/deployment.md) for network, database, and deploy
details.

## Backend API

```bash
npm run api
```

The API listens on `http://127.0.0.1:3001` by default. It uses Prisma-backed
SQLite state by default and exposes the core MVP flow: parse intent, create
intent, query the intent book, run matching, compare costs, and read agent
decisions.

## Web Console

```bash
npm run api
npm run web
```

Run the two commands in separate terminals. The Next.js console opens at
`http://127.0.0.1:3000` and proxies `/api/*` requests to the backend on port
`3001`. The web console uses wagmi/viem to submit intents and decision logs to
the deployed Mantle Sepolia contracts.

## Optional AI Layer

OpenAI is optional for this MVP. If `OPENAI_API_KEY` is empty, the parser and
decision explanation use deterministic local fallbacks, so development and demo
rehearsal can run with no model API cost. If a valid key is configured, the
API uses strict JSON structured output for parsing and explanation wording, but
matching math, residual exposure, and cost comparison remain deterministic.

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
