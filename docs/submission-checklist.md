# Submission Checklist

Target submission date: 2026-06-03.

## Final Smoke Test

```bash
npm run db:init
npm run demo:reset
npm test
npm run web:build
```

Then run:

```bash
npm run api
npm run web
```

Verify:

- Web console opens at `http://127.0.0.1:3000`.
- Static fallback console opens at `http://127.0.0.1:3001`.
- Wallet connects to Mantle Sepolia.
- `IntentBook` and `MatchLog` links open in the explorer.
- Default `$10,000 SHORT MNT` intent submits to Mantle and DB.
- Matching produces `$7,000` internal match and `$3,000 SHORT` residual.
- Dashboard shows `70%` match rate and `$14,000` external liquidity avoided.
- `Log Decision` records Mantle Sepolia tx hashes.

## Submission Assets

- GitHub repo URL: `https://github.com/DevChanPark/ZeroSlip_HedgeMesh`
- IntentBook: `0x7489039281b77aab0ef24f56e333f28cfc352ee9`
- MatchLog: `0xc02797d86f47ac6757383039b4bb5c2d9fe4e3cc`
- Network: Mantle Sepolia, chain id `5003`
- Demo video: record wallet connect, submit, match, dashboard, and tx hashes.

## Positioning

ZeroSlip HedgeMesh is an AI-assisted hedge intent netting layer. It is not a
volume farming bot, arbitrage bot, full perpetual exchange, or liquidation
engine. The MVP proves that opposite hedge demand can be netted internally and
only residual exposure needs external liquidity.

## Do Not Add Before Submission

- Real DEX execution.
- Production margin or liquidation.
- Insurance fund logic.
- Oracle dispute logic.
- Mandatory OpenAI dependency.
