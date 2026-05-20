const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config();

const hre = require("hardhat");

const NETWORK_NAME = "mantle-sepolia";
const CHAIN_ID = 5003;
const EXPLORER_URL =
  process.env.MANTLE_SEPOLIA_EXPLORER_URL || "https://explorer.sepolia.mantle.xyz";

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  if (!deployer) {
    throw new Error("DEPLOYER_PRIVATE_KEY is required for Mantle Sepolia deployment");
  }

  const network = await deployer.provider.getNetwork();
  if (network.chainId !== CHAIN_ID) {
    throw new Error(`Wrong network: expected chainId ${CHAIN_ID}, got ${network.chainId}`);
  }

  const balance = await deployer.getBalance();
  console.log(`Deploying with ${deployer.address}`);
  console.log(`Balance: ${hre.ethers.utils.formatEther(balance)} MNT`);

  const IntentBook = await hre.ethers.getContractFactory("IntentBook");
  const intentBook = await IntentBook.deploy();
  await intentBook.deployed();

  const MatchLog = await hre.ethers.getContractFactory("MatchLog");
  const matchLog = await MatchLog.deploy();
  await matchLog.deployed();

  const deployments = [
    {
      network: NETWORK_NAME,
      chainId: CHAIN_ID,
      contractName: "IntentBook",
      contractAddress: intentBook.address,
      deployTxHash: intentBook.deployTransaction.hash,
      deployerAddress: deployer.address,
      explorerUrl: `${EXPLORER_URL}/address/${intentBook.address}`
    },
    {
      network: NETWORK_NAME,
      chainId: CHAIN_ID,
      contractName: "MatchLog",
      contractAddress: matchLog.address,
      deployTxHash: matchLog.deployTransaction.hash,
      deployerAddress: deployer.address,
      explorerUrl: `${EXPLORER_URL}/address/${matchLog.address}`
    }
  ];

  writeDeploymentFile(deployments);
  await persistDeployments(deployments);

  console.log(JSON.stringify({ deployments }, null, 2));
}

function writeDeploymentFile(deployments) {
  const outDir = path.join(process.cwd(), "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "mantle-sepolia.json"),
    JSON.stringify({ deployments, updatedAt: new Date().toISOString() }, null, 2)
  );
}

async function persistDeployments(deployments) {
  try {
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();

    for (const deployment of deployments) {
      await prisma.chainDeployment.upsert({
        where: {
          network_contractName: {
            network: deployment.network,
            contractName: deployment.contractName
          }
        },
        update: deployment,
        create: {
          id: `${deployment.network}:${deployment.contractName}`,
          ...deployment
        }
      });
    }

    await prisma.$disconnect();
  } catch (error) {
    console.warn(`Deployment file written, but DB persistence was skipped: ${error.message}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

