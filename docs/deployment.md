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
```

Never commit a funded private key.

## Local Setup

```bash
npm install
npm run db:generate
npm run db:seed
npm run compile
npm run chain:check
```

For a clean database with the committed migration:

```bash
npx prisma migrate deploy
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

