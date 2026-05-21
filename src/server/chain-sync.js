import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createPublicClient, http, parseAbiItem } from "viem";

import { recordChainEvent } from "./hedge-service.js";

const NETWORK = {
  name: "mantle-sepolia",
  chainId: 5003,
  rpcUrl: "https://rpc.sepolia.mantle.xyz",
  explorerUrl: "https://explorer.sepolia.mantle.xyz"
};

const MANTLE_SEPOLIA_CHAIN = {
  id: NETWORK.chainId,
  name: "Mantle Sepolia",
  nativeCurrency: {
    decimals: 18,
    name: "MNT",
    symbol: "MNT"
  },
  rpcUrls: {
    default: { http: [NETWORK.rpcUrl] }
  }
};

const CONTRACT_EVENTS = {
  IntentBook: [
    parseAbiItem(
      "event HedgeIntentSubmitted(bytes32 indexed intentId, address indexed user, string asset, string direction, uint256 notionalUsd, uint256 durationMinutes, uint256 maxCostBps, uint256 createdAt, uint256 expiresAt)"
    ),
    parseAbiItem("event HedgeIntentCancelled(bytes32 indexed intentId, address indexed user)"),
    parseAbiItem("event HedgeIntentExpired(bytes32 indexed intentId, address indexed user)"),
    parseAbiItem(
      "event HedgeIntentMatched(bytes32 indexed intentId, address indexed user, uint256 matchedNotionalUsd, uint256 filledNotionalUsd, uint8 status)"
    )
  ],
  MatchLog: [
    parseAbiItem(
      "event HedgeMatched(bytes32 indexed matchId, string asset, uint256 matchedNotionalUsd, uint256 residualNotionalUsd, uint256 estimatedSavingsBps, uint256 createdAt)"
    ),
    parseAbiItem(
      "event AgentDecisionLogged(bytes32 indexed decisionId, string decisionType, uint256 internalMatchUsd, uint256 residualUsd, uint256 estimatedSavingsBps, uint256 createdAt)"
    )
  ]
};

export async function syncMantleSepoliaEvents(prisma, input = {}, options = {}) {
  const network = input.network ?? NETWORK.name;
  if (network !== NETWORK.name) {
    return { ok: false, status: 400, errors: [`unsupported network: ${network}`] };
  }

  const deployments = await loadDeployments(prisma, network);
  const contracts = deployments.filter((deployment) => {
    if (!CONTRACT_EVENTS[deployment.contractName]) return false;
    return !input.contractName || deployment.contractName === input.contractName;
  });

  if (contracts.length === 0) {
    return { ok: false, status: 404, errors: ["no syncable deployments found"] };
  }

  const rpcUrl = options.rpcUrl ?? process.env.MANTLE_SEPOLIA_RPC_URL ?? NETWORK.rpcUrl;
  const client =
    options.client ??
    createPublicClient({
      chain: {
        ...MANTLE_SEPOLIA_CHAIN,
        rpcUrls: { default: { http: [rpcUrl] } }
      },
      transport: http(rpcUrl)
    });

  const latestBlock = await resolveLatestBlock(client, input.toBlock);
  const fromBlock = await resolveFromBlock(prisma, network, contracts, input.fromBlock);
  const toBlock = parseBlockInput(input.toBlock, latestBlock) ?? latestBlock;

  if (fromBlock > toBlock) {
    return {
      ok: true,
      status: 200,
      network,
      fromBlock: Number(fromBlock),
      toBlock: Number(toBlock),
      syncedCount: 0,
      duplicateCount: 0,
      events: []
    };
  }

  const events = [];
  let syncedCount = 0;
  let duplicateCount = 0;

  for (const deployment of contracts) {
    for (const event of CONTRACT_EVENTS[deployment.contractName]) {
      const logs = await client.getLogs({
        address: deployment.contractAddress,
        event,
        fromBlock,
        toBlock
      });

      for (const log of logs) {
        const record = await buildChainEventRecord(prisma, {
          deployment,
          log,
          network,
          eventName: event.name
        });
        const result = await recordChainEvent(prisma, record, {
          now: typeof options.now === "function" ? options.now() : options.now
        });

        if (result.ok) {
          if (result.event.duplicate) duplicateCount += 1;
          else syncedCount += 1;
          events.push(result.event);
        }
      }
    }
  }

  return {
    ok: true,
    status: 200,
    network,
    fromBlock: Number(fromBlock),
    toBlock: Number(toBlock),
    syncedCount,
    duplicateCount,
    events
  };
}

async function loadDeployments(prisma, network) {
  const fileDeployments = await readDeploymentFile(network);
  const dbDeployments = await prisma.chainDeployment.findMany({
    where: { network },
    orderBy: [{ contractName: "asc" }]
  });
  const byName = new Map(fileDeployments.map((deployment) => [deployment.contractName, deployment]));

  for (const deployment of dbDeployments) {
    byName.set(deployment.contractName, {
      ...byName.get(deployment.contractName),
      ...deployment
    });
  }

  return [...byName.values()].filter((deployment) => deployment.contractAddress);
}

async function readDeploymentFile(network) {
  try {
    const file = await readFile(path.join(process.cwd(), "deployments", `${network}.json`), "utf8");
    const parsed = JSON.parse(file);
    return Array.isArray(parsed.deployments) ? parsed.deployments : [];
  } catch {
    return [];
  }
}

async function resolveLatestBlock(client, toBlockInput) {
  const fixed = parseBlockInput(toBlockInput);
  if (fixed !== null) return fixed;
  return client.getBlockNumber();
}

async function resolveFromBlock(prisma, network, deployments, fromBlockInput) {
  const fixed = parseBlockInput(fromBlockInput);
  if (fixed !== null) return fixed;

  const latestEvent = await prisma.chainEvent.findFirst({
    where: { network, blockNumber: { not: null } },
    orderBy: [{ blockNumber: "desc" }]
  });
  if (latestEvent?.blockNumber) {
    return BigInt(Math.max(0, latestEvent.blockNumber - 20));
  }

  const startBlocks = deployments
    .map((deployment) => Number(deployment.blockNumber ?? 0))
    .filter((blockNumber) => Number.isFinite(blockNumber) && blockNumber >= 0);
  return BigInt(startBlocks.length > 0 ? Math.min(...startBlocks) : 0);
}

function parseBlockInput(value, latestBlock) {
  if (value === undefined || value === null || value === "") return null;
  if (value === "latest") return latestBlock ?? null;
  const block = Number(value);
  if (!Number.isFinite(block) || block < 0) return null;
  return BigInt(Math.trunc(block));
}

async function buildChainEventRecord(prisma, { deployment, eventName, log, network }) {
  const args = sanitizePayload(log.args ?? {});
  const onchainId = getOnchainId(eventName, args);
  const local = await findLocalEntity(prisma, eventName, onchainId);
  const logIndex = Number(log.logIndex ?? 0);
  const txHash = log.transactionHash;

  return {
    id: `chain_event_${network}_${txHash.slice(2)}_${logIndex}_${eventName}`,
    network,
    chainId: Number(deployment.chainId ?? NETWORK.chainId),
    contractName: deployment.contractName,
    contractAddress: deployment.contractAddress,
    eventName,
    txHash,
    blockNumber: log.blockNumber === undefined || log.blockNumber === null ? null : Number(log.blockNumber),
    intentId: local.intentId,
    matchId: local.matchId,
    decisionId: local.decisionId,
    onchainId,
    payload: args
  };
}

function getOnchainId(eventName, args) {
  if (eventName.startsWith("HedgeIntent")) return args.intentId;
  if (eventName === "HedgeMatched") return args.matchId;
  if (eventName === "AgentDecisionLogged") return args.decisionId;
  return null;
}

async function findLocalEntity(prisma, eventName, onchainId) {
  if (!onchainId) return {};
  if (eventName.startsWith("HedgeIntent")) {
    const intent = await prisma.hedgeIntent.findFirst({
      where: { onchainIntentId: onchainId }
    });
    return { intentId: intent?.id };
  }

  if (eventName === "HedgeMatched") {
    const match = await findByHashedId(prisma.hedgeMatch, onchainId, {
      onchainMatchId: onchainId
    });
    return { matchId: match?.id };
  }

  if (eventName === "AgentDecisionLogged") {
    const decision = await findByHashedId(prisma.agentDecision, onchainId);
    return { decisionId: decision?.id };
  }

  return {};
}

async function findByHashedId(model, onchainId, directWhere) {
  const normalized = onchainId.toLowerCase();
  if (directWhere) {
    const direct = await model.findFirst({ where: directWhere });
    if (direct) return direct;
  }

  const candidates = await model.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: 250
  });
  return candidates.find((candidate) => bytes32FromText(candidate.id) === normalized) ?? null;
}

function bytes32FromText(text) {
  return `0x${createHash("sha256").update(text).digest("hex")}`;
}

function sanitizePayload(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => sanitizePayload(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizePayload(item)])
    );
  }
  return value;
}
