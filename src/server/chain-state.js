import { createPublicClient, http } from "viem";

import { loadDeployments } from "./chain-sync.js";

const LOCAL_ONLY_STATUS = "LOCAL_ONLY";
const NETWORK = {
  name: "mantle-sepolia",
  chainId: 5003,
  rpcUrl: "https://rpc.sepolia.mantle.xyz"
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

const INTENT_STATUS = ["OPEN", "PARTIALLY_MATCHED", "MATCHED", "CANCELLED", "EXPIRED"];

const INTENT_BOOK_ABI = [
  {
    type: "function",
    name: "intents",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [
      { name: "user", type: "address" },
      { name: "asset", type: "string" },
      { name: "direction", type: "string" },
      { name: "notionalUsd", type: "uint256" },
      { name: "durationMinutes", type: "uint256" },
      { name: "maxCostBps", type: "uint256" },
      { name: "urgency", type: "string" },
      { name: "filledNotionalUsd", type: "uint256" },
      { name: "createdAt", type: "uint256" },
      { name: "expiresAt", type: "uint256" },
      { name: "status", type: "uint8" }
    ]
  }
];

export async function reconcileMantleSepoliaIntents(prisma, input = {}, options = {}) {
  const network = input.network ?? NETWORK.name;
  if (network !== NETWORK.name) {
    return { ok: false, status: 400, errors: [`unsupported network: ${network}`] };
  }

  const deployments = await loadDeployments(prisma, network);
  const intentBook = deployments.find((deployment) => deployment.contractName === "IntentBook");
  if (!intentBook) {
    return { ok: false, status: 404, errors: ["IntentBook deployment not found"] };
  }

  const asset = normalizeAsset(input.asset);
  const dbIntents = await prisma.hedgeIntent.findMany({
    where: asset ? { asset } : {},
    orderBy: [{ createdAt: "desc" }],
    take: clampNumber(input.limit, 1, 100, 40)
  });

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

  const rows = [];
  for (const intent of dbIntents) {
    rows.push(await reconcileIntent(client, intentBook, intent));
  }

  const summary = rows.reduce(
    (totals, row) => {
      totals.total += 1;
      if (row.onchainIntentId) totals.withOnchainId += 1;
      if (row.chain.exists) totals.checked += 1;
      if (row.consistent) totals.consistent += 1;
      if (row.differences.length > 0) totals.mismatched += 1;
      if (!row.onchainIntentId) totals.localOnly += 1;
      if (row.chain.error) totals.readFailed += 1;
      return totals;
    },
    {
      total: 0,
      withOnchainId: 0,
      checked: 0,
      consistent: 0,
      mismatched: 0,
      localOnly: 0,
      readFailed: 0
    }
  );

  return {
    ok: true,
    status: 200,
    network,
    contractAddress: intentBook.contractAddress,
    asset: asset ?? "ALL",
    summary,
    intents: rows
  };
}

export async function repairMantleSepoliaIntents(prisma, input = {}, options = {}) {
  const action = input.action;
  if (!["APPLY_CHAIN_STATE", "ARCHIVE_LOCAL_ONLY", "APPLY_ALL"].includes(action)) {
    return {
      ok: false,
      status: 400,
      errors: ["action must be APPLY_CHAIN_STATE, ARCHIVE_LOCAL_ONLY, or APPLY_ALL"]
    };
  }

  const before = await reconcileMantleSepoliaIntents(prisma, input, options);
  if (!before.ok) return before;

  const updates = [];
  if (action === "ARCHIVE_LOCAL_ONLY" || action === "APPLY_ALL") {
    for (const row of before.intents) {
      if (!row.onchainIntentId && row.db.status !== LOCAL_ONLY_STATUS) {
        const updated = await prisma.hedgeIntent.update({
          where: { id: row.intentId },
          data: { status: LOCAL_ONLY_STATUS }
        });
        updates.push({
          intentId: row.intentId,
          action: "ARCHIVE_LOCAL_ONLY",
          before: row.db.status,
          after: updated.status
        });
      }
    }
  }

  if (action === "APPLY_CHAIN_STATE" || action === "APPLY_ALL") {
    for (const row of before.intents) {
      if (!row.chain.exists) continue;

      const data = {};
      if (row.db.status !== row.chain.status) data.status = row.chain.status;
      if (row.db.filledNotionalUsd !== row.chain.filledNotionalUsd) {
        data.filledNotionalUsd = row.chain.filledNotionalUsd;
      }
      if (row.chain.expiresAt) {
        data.expiresAt = new Date(row.chain.expiresAt);
      }

      if (Object.keys(data).length > 0) {
        await prisma.hedgeIntent.update({
          where: { id: row.intentId },
          data
        });
        updates.push({
          intentId: row.intentId,
          action: "APPLY_CHAIN_STATE",
          before: {
            status: row.db.status,
            filledNotionalUsd: row.db.filledNotionalUsd
          },
          after: {
            status: data.status ?? row.db.status,
            filledNotionalUsd: data.filledNotionalUsd ?? row.db.filledNotionalUsd
          }
        });
      }
    }
  }

  const reconciliation = await reconcileMantleSepoliaIntents(prisma, input, options);
  return {
    ok: true,
    status: 200,
    network: before.network,
    action,
    updatedCount: updates.length,
    updates,
    reconciliation: reconciliation.ok ? reconciliation : before
  };
}

async function reconcileIntent(client, intentBook, intent) {
  const db = serializeDbIntent(intent);
  const row = {
    intentId: intent.id,
    onchainIntentId: intent.onchainIntentId,
    db,
    chain: {
      exists: false,
      status: null,
      filledNotionalUsd: null
    },
    consistent: false,
    differences: []
  };

  if (!intent.onchainIntentId) {
    if (intent.status !== LOCAL_ONLY_STATUS) {
      row.differences.push({
        field: "onchainIntentId",
        db: null,
        chain: "missing"
      });
    }
    return row;
  }

  if (!isBytes32(intent.onchainIntentId)) {
    row.chain.error = "invalid onchainIntentId";
    row.differences.push({
      field: "onchainIntentId",
      db: intent.onchainIntentId,
      chain: "invalid bytes32"
    });
    return row;
  }

  try {
    const raw = await client.readContract({
      address: intentBook.contractAddress,
      abi: INTENT_BOOK_ABI,
      functionName: "intents",
      args: [intent.onchainIntentId]
    });
    const chain = serializeChainIntent(raw);
    row.chain = chain;
    row.differences = compareIntentState(db, chain);
    row.consistent = chain.exists && row.differences.length === 0;
    return row;
  } catch (error) {
    row.chain.error = error instanceof Error ? error.message : String(error);
    row.differences.push({
      field: "chainRead",
      db: "readable",
      chain: "failed"
    });
    return row;
  }
}

function serializeDbIntent(intent) {
  return {
    user: intent.walletAddress,
    asset: intent.asset,
    direction: intent.direction,
    notionalUsd: Number(intent.notionalUsd),
    durationMinutes: intent.durationMinutes,
    maxCostBps: Number(intent.maxCostBps),
    urgency: intent.urgency,
    filledNotionalUsd: Number(intent.filledNotionalUsd),
    status: intent.status,
    createdAt: intent.createdAt.getTime(),
    expiresAt: intent.expiresAt.getTime()
  };
}

function serializeChainIntent(raw) {
  const [
    user,
    asset,
    direction,
    notionalUsd,
    durationMinutes,
    maxCostBps,
    urgency,
    filledNotionalUsd,
    createdAt,
    expiresAt,
    status
  ] = raw;
  const statusName = INTENT_STATUS[Number(status)] ?? `UNKNOWN_${String(status)}`;
  const exists = user !== "0x0000000000000000000000000000000000000000";

  return {
    exists,
    user,
    asset,
    direction,
    notionalUsd: Number(notionalUsd),
    durationMinutes: Number(durationMinutes),
    maxCostBps: Number(maxCostBps),
    urgency,
    filledNotionalUsd: Number(filledNotionalUsd),
    status: statusName,
    createdAt: Number(createdAt) * 1000,
    expiresAt: Number(expiresAt) * 1000
  };
}

function compareIntentState(db, chain) {
  if (!chain.exists) {
    return [{ field: "exists", db: "present", chain: "missing" }];
  }

  const fields = [
    "user",
    "asset",
    "direction",
    "notionalUsd",
    "durationMinutes",
    "maxCostBps",
    "urgency",
    "filledNotionalUsd",
    "status"
  ];
  const differences = [];
  for (const field of fields) {
    if (!isSameValue(field, db[field], chain[field])) {
      differences.push({
        field,
        db: db[field],
        chain: chain[field]
      });
    }
  }
  return differences;
}

function isSameValue(field, left, right) {
  if (field === "user") return String(left).toLowerCase() === String(right).toLowerCase();
  return left === right;
}

function normalizeAsset(asset) {
  if (!asset) return null;
  const normalized = String(asset);
  if (normalized.toUpperCase() === "METH") return "mETH";
  return normalized.toUpperCase();
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function isBytes32(value) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(value));
}
