require("dotenv").config();
require("@nomiclabs/hardhat-ethers");

const MANTLE_SEPOLIA_RPC_URL =
  process.env.MANTLE_SEPOLIA_RPC_URL || "https://rpc.sepolia.mantle.xyz";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";

function deploymentAccounts() {
  return DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [];
}

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 31337
    },
    mantleSepolia: {
      url: MANTLE_SEPOLIA_RPC_URL,
      chainId: 5003,
      accounts: deploymentAccounts()
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test/contracts",
    cache: "./cache/hardhat",
    artifacts: "./artifacts"
  }
};

