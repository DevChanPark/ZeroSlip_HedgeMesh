require("dotenv").config();

const { ethers } = require("ethers");

const EXPECTED_CHAIN_ID = Number(process.env.MANTLE_SEPOLIA_CHAIN_ID || 5003);
const rpcUrl = process.env.MANTLE_SEPOLIA_RPC_URL || "https://rpc.sepolia.mantle.xyz";

async function main() {
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const [network, blockNumber] = await Promise.all([
    provider.getNetwork(),
    provider.getBlockNumber()
  ]);

  if (network.chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `Unexpected Mantle Sepolia chainId: expected ${EXPECTED_CHAIN_ID}, got ${network.chainId}`
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        network: network.name,
        chainId: network.chainId,
        blockNumber,
        rpcUrl
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

