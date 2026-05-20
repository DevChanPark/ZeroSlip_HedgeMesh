# Demo Script

## Judge Story

ZeroSlip HedgeMesh reduces hedge cost by netting opposite hedge intents before
touching external liquidity.

## Demo Path

1. Open the pitch view and show the problem: hedging reduces risk, but repeated
   external execution creates slippage, fees, spreads, and market impact.
2. Submit a natural-language SHORT MNT hedge intent.
3. Submit or seed a compatible LONG MNT hedge intent.
4. Show the intent book with LONG and SHORT demand.
5. Run matching.
6. Show internal match amount, residual hedge, match rate, and avoided external
   liquidity.
7. Show naive cost vs HedgeMesh cost.
8. Show the agent decision explanation.
9. Show Mantle tx hash for intent and decision logs.

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

