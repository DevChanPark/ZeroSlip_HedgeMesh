# Demo Script

## Judge Story

ZeroSlip HedgeMesh reduces hedge cost by netting opposite hedge intents before
touching external liquidity.

## Demo Path

### Wallet Demo

Prep:

```bash
npm run db:init
npm run demo:reset
npm run api
npm run web
```

Path:

1. Open `http://127.0.0.1:3000` and connect the operator wallet on Mantle
   Sepolia.
2. Show the deployed `IntentBook` and `MatchLog` contract links.
3. Press `AI Parse` on the default `$10,000 SHORT MNT` natural-language hedge
   request.
4. Press `Submit to Mantle + DB` and show the `HedgeIntentSubmitted` tx hash.
5. Show the intent book with the wallet-submitted SHORT demand and seeded
   `$7,000 LONG MNT` counterparty demand.
6. Press `Run Matching`.
7. Show internal match amount, residual hedge, match rate, and avoided external
   liquidity.
8. Press `Sync Fills` to update the submitted IntentBook state.
9. Press `Log Decision` and show the `HedgeMatched` /
   `AgentDecisionLogged` tx hashes.
10. Close by showing dashboard KPIs and recent on-chain logs.

If the Next.js dev server is slow locally, keep `npm run api` running and open
`http://127.0.0.1:3001` instead. The API serves a static fallback console with
the same core submit, matching, KPI, and decision-log flow.

### No-Wallet Rehearsal

```bash
npm run demo:reset:golden
npm run demo:db
```

This proves the same golden KPI with DB-backed state if wallet/RPC UX is slow
during practice.

## Golden Numbers

```text
SHORT demand: $10,000
LONG demand:  $7,000
Internal match: $7,000
Residual: $3,000 SHORT
External liquidity avoided: $14,000
Internal match rate: 70%
Naive hedge cost: about 26 bps
HedgeMesh cost: about 7 bps
Saved: about 19 bps
```

## Closing Line

ZeroSlip HedgeMesh is not trying to generate more volume. It is trying to make
legitimate hedging cheaper by reducing the amount of volume that needs to hit
external markets in the first place.

## Failure Fallbacks

- If the OpenAI key is empty or invalid, keep going. The deterministic parser
  and decision explanation are the intended fallback.
- If Mantle RPC is slow after `Submit to Mantle + DB`, use the explorer link to
  show the submitted transaction and continue from the DB state.
- If `Sync Fills` is not needed because the counterparty is local-only, explain
  that the MVP records fills for any submitted on-chain intent and keeps
  matching math off-chain for deterministic reproducibility.
