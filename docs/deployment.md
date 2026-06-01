# Mantle Sepolia Deployment

## Network

```text
Network: Mantle Sepolia Testnet
Chain ID: 5003
Currency: MNT
RPC: https://rpc.sepolia.mantle.xyz
Explorer: https://explorer.sepolia.mantle.xyz
Faucet: https://faucet.sepolia.mantle.xyz
```

## Environment

Copy `.env.example` to `.env` and fill only local values.

```text
DATABASE_URL="file:./dev.db"
MANTLE_SEPOLIA_RPC_URL="https://rpc.sepolia.mantle.xyz"
MANTLE_SEPOLIA_CHAIN_ID="5003"
MANTLE_SEPOLIA_EXPLORER_URL="https://explorer.sepolia.mantle.xyz"
DEPLOYER_PRIVATE_KEY="..."
OPENAI_API_KEY=""
OPENAI_MODEL="gpt-4o-mini"
OPENAI_TIMEOUT_MS="12000"
```

Never commit a funded private key.
`OPENAI_API_KEY` is optional. When it is unset, the parser and decision
explanation use deterministic local fallbacks.

## Local Setup

```bash
npm install
npm run db:generate
npm run db:init
npm run demo:reset:golden
npm run compile
npm run chain:check
```

For a clean database with the committed migration:

```bash
npm run db:init
```

For a repeatable judge demo database:

```bash
npm run demo:reset
```

## Deploy Contracts

The deploy script requires a Mantle Sepolia-funded deployer key in
`DEPLOYER_PRIVATE_KEY`.

```bash
npm run deploy:mantle-sepolia
```

The script deploys:

- `IntentBook`
- `MatchLog`

It writes deployment metadata to:

```text
deployments/mantle-sepolia.json
```

It also persists contract addresses into the `ChainDeployment` table when the
Prisma client and database are available.

## Operator Wallet

The deployer wallet is the initial `operator` for both contracts.

- `IntentBook.markIntentMatched` requires the `IntentBook` operator.
- `MatchLog.logMatch` and `MatchLog.logAgentDecision` require the `MatchLog`
  operator.

The web console reads each contract's `operator()` value on Mantle Sepolia and
shows it in the header. Use the same wallet as the operator when pressing
`Sync Fills` or `Log Decision`; otherwise the UI blocks the action before
sending a transaction.
