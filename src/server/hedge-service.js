import { randomUUID } from "node:crypto";

import { compareCosts } from "../core/cost.js";
import { buildAgentDecision } from "../core/decision.js";
import { matchIntents } from "../core/matching.js";
import {
  ACTIVE_STATUSES,
  createIntent,
  normalizeAsset,
  validateIntentDraft
} from "../core/model.js";
import { parseNaturalLanguageIntent } from "../core/parser.js";

export function parseIntentText(text) {
  return parseNaturalLanguageIntent(text);
}

export async function createHedgeIntent(prisma, input, options = {}) {
  const now = options.now ?? Date.now();
  const draft = {
    user: input.user,
    asset: input.asset,
    direction: input.direction,
    notionalUsd: Number(input.notionalUsd),
    durationMinutes: Number(input.durationMinutes),
    maxCostBps: Number(input.maxCostBps),
    urgency: input.urgency
  };

  const validation = validateIntentDraft(draft);
  const errors = [...validation.errors];
  if (!draft.user || typeof draft.user !== "string") errors.push("user is required");
  if (errors.length > 0) {
    return { ok: false, status: 400, errors };
  }

  const intent = createIntent(draft, {
    createdAt: now,
    intentId: input.intentId ?? `intent_${validation.value.asset}_${randomUUID()}`
  });

  const saved = await prisma.hedgeIntent.create({
    data: {
      id: intent.intentId,
      walletAddress: intent.user,
      asset: intent.asset,
      direction: intent.direction,
      notionalUsd: intent.notionalUsd,
      durationMinutes: intent.durationMinutes,
      maxCostBps: intent.maxCostBps,
      urgency: intent.urgency,
      status: intent.status,
      filledNotionalUsd: intent.filledNotionalUsd,
      naturalLanguage: input.naturalLanguage ?? null,
      parserConfidence: input.parserConfidence ?? null,
      onchainIntentId: input.onchainIntentId ?? null,
      submitTxHash: input.submitTxHash ?? null,
      createdAt: new Date(intent.createdAt),
      expiresAt: new Date(intent.expiresAt)
    }
  });

  return { ok: true, status: 201, intent: serializeIntent(saved) };
}

export async function cancelHedgeIntent(prisma, intentId, input = {}) {
  if (!intentId) {
    return { ok: false, status: 400, errors: ["intentId is required"] };
  }
  if (!input.user) {
    return { ok: false, status: 400, errors: ["user is required"] };
  }

  const intent = await prisma.hedgeIntent.findUnique({ where: { id: intentId } });
  if (!intent) {
    return { ok: false, status: 404, errors: ["intent not found"] };
  }

  if (intent.walletAddress.toLowerCase() !== String(input.user).toLowerCase()) {
    return { ok: false, status: 403, errors: ["only the intent owner can cancel"] };
  }

  if (!ACTIVE_STATUSES.includes(intent.status)) {
    return { ok: false, status: 409, errors: [`intent is not cancellable from ${intent.status}`] };
  }

  const updated = await prisma.hedgeIntent.update({
    where: { id: intentId },
    data: { status: "CANCELLED" }
  });

  return { ok: true, status: 200, intent: serializeIntent(updated) };
}

export async function expireHedgeIntents(prisma, input = {}, options = {}) {
  const now = options.now ?? Date.now();
  const asset = normalizeAsset(input.asset);
  const where = {
    ...(asset ? { asset } : {}),
    status: { in: ACTIVE_STATUSES },
    expiresAt: { lte: new Date(now) }
  };

  const expired = await prisma.hedgeIntent.findMany({
    where,
    orderBy: [{ expiresAt: "asc" }]
  });

  if (expired.length > 0) {
    await prisma.hedgeIntent.updateMany({
      where: { id: { in: expired.map((intent) => intent.id) } },
      data: { status: "EXPIRED" }
    });
  }

  return {
    ok: true,
    status: 200,
    expiredCount: expired.length,
    intents: expired.map((intent) => serializeIntent({ ...intent, status: "EXPIRED" }))
  };
}

export async function listIntents(prisma, query = {}) {
  const asset = normalizeAsset(query.asset);
  const where = asset ? { asset } : {};
  const intents = await prisma.hedgeIntent.findMany({
    where,
    orderBy: [{ createdAt: "asc" }]
  });

  const active = intents.filter((intent) => ACTIVE_STATUSES.includes(intent.status));
  const shortDemandUsd = sum(
    active
      .filter((intent) => intent.direction === "SHORT")
      .map((intent) => remainingDbNotionalUsd(intent))
  );
  const longDemandUsd = sum(
    active
      .filter((intent) => intent.direction === "LONG")
      .map((intent) => remainingDbNotionalUsd(intent))
  );

  return {
    asset: asset ?? "ALL",
    shortDemandUsd,
    longDemandUsd,
    intents: intents.map(serializeIntent)
  };
}

export async function runMatching(prisma, input, options = {}) {
  const asset = normalizeAsset(input.asset);
  if (!asset) {
    return { ok: false, status: 400, errors: ["supported asset is required"] };
  }

  const now = options.now ?? Date.now();
  const matchId = input.matchId ?? `match_${asset}_${randomUUID()}`;
  const decisionId = input.decisionId ?? `decision_${asset}_${randomUUID()}`;

  const dbIntents = await prisma.hedgeIntent.findMany({
    where: {
      asset,
      status: {
        in: ACTIVE_STATUSES
      }
    },
    orderBy: [{ createdAt: "asc" }]
  });

  const matchResult = {
    ...matchIntents(dbIntents.map(toCoreIntent), { asset, now, matchId }),
    matchId
  };
  matchResult.allocations = enrichAllocations(matchResult.allocations, dbIntents);
  const costComparison = compareCosts(matchResult);
  const decision = buildAgentDecision(
    {
      asset,
      matchResult,
      costComparison,
      maxCostBps: input.maxCostBps,
      urgency: input.urgency
    },
    { now, decisionId }
  );

  await prisma.$transaction(async (tx) => {
    await tx.hedgeMatch.create({
      data: {
        id: matchId,
        asset,
        matchedNotionalUsd: matchResult.matchedNotionalUsd,
        residualDirection: matchResult.residualDirection,
        residualNotionalUsd: matchResult.residualNotionalUsd,
        naiveExternalVolumeUsd: costComparison.naiveExternalVolumeUsd,
        meshExternalVolumeUsd: costComparison.meshExternalVolumeUsd,
        externalLiquidityAvoidedUsd: costComparison.externalLiquidityAvoidedUsd,
        naiveCostBps: costComparison.naiveCostBps,
        meshCostBps: costComparison.meshCostBps,
        savedCostBps: costComparison.savedCostBps,
        savedCostUsd: costComparison.savedCostUsd,
        createdAt: new Date(now)
      }
    });

    for (const allocation of matchResult.allocations) {
      await tx.matchAllocation.create({
        data: {
          id: `${matchId}:${allocation.shortIntentId}:${allocation.longIntentId}`,
          matchId,
          shortIntentId: allocation.shortIntentId,
          longIntentId: allocation.longIntentId,
          matchedUsd: allocation.matchedUsd,
          createdAt: new Date(now)
        }
      });
      await applyFill(tx, allocation.shortIntentId, allocation.matchedUsd);
      await applyFill(tx, allocation.longIntentId, allocation.matchedUsd);
    }

    await tx.agentDecision.create({
      data: {
        id: decisionId,
        matchId,
        decisionType: decision.decisionType,
        asset,
        internalMatchUsd: decision.internalMatchUsd,
        residualUsd: decision.residualUsd,
        reason: decision.reason,
        risksJson: JSON.stringify(decision.risks),
        recommendedAction: decision.recommendedAction,
        createdAt: new Date(now)
      }
    });
  });

  return {
    ok: true,
    status: 201,
    matchResult,
    costComparison,
    decision
  };
}

export async function getDecision(prisma, decisionId) {
  const decision = await prisma.agentDecision.findUnique({
    where: { id: decisionId },
    include: { match: true }
  });
  if (!decision) return null;

  return {
    decisionId: decision.id,
    decisionType: decision.decisionType,
    asset: decision.asset,
    internalMatchUsd: Number(decision.internalMatchUsd),
    residualUsd: Number(decision.residualUsd),
    reason: decision.reason,
    risks: JSON.parse(decision.risksJson),
    recommendedAction: decision.recommendedAction,
    txHash: decision.txHash,
    createdAt: decision.createdAt.getTime(),
    matchId: decision.matchId
  };
}

export async function recordChainEvent(prisma, input, options = {}) {
  const required = [
    "network",
    "chainId",
    "contractName",
    "contractAddress",
    "eventName",
    "txHash"
  ];
  const missing = required.filter((field) => !input[field]);
  if (missing.length > 0) {
    return { ok: false, status: 400, errors: missing.map((field) => `${field} is required`) };
  }

  const now = options.now ?? Date.now();
  const payloadJson =
    typeof input.payloadJson === "string"
      ? input.payloadJson
      : JSON.stringify(input.payload ?? {});

  const event = await prisma.chainEvent.create({
    data: {
      id: input.id ?? `chain_event_${randomUUID()}`,
      network: input.network,
      chainId: Number(input.chainId),
      contractName: input.contractName,
      contractAddress: input.contractAddress,
      eventName: input.eventName,
      txHash: input.txHash,
      blockNumber:
        input.blockNumber === undefined || input.blockNumber === null
          ? null
          : Number(input.blockNumber),
      payloadJson,
      createdAt: new Date(now)
    }
  });

  if (input.eventName === "HedgeMatched" && input.matchId) {
    const data = { logTxHash: input.txHash };
    if (input.onchainId) data.onchainMatchId = input.onchainId;
    await prisma.hedgeMatch.updateMany({
      where: { id: input.matchId },
      data
    });
  }

  if (input.eventName === "AgentDecisionLogged" && input.decisionId) {
    await prisma.agentDecision.updateMany({
      where: { id: input.decisionId },
      data: { txHash: input.txHash }
    });
  }

  if (input.eventName === "HedgeIntentCancelled") {
    const where = intentIdentityWhere(input);
    if (where) {
      await prisma.hedgeIntent.updateMany({
        where,
        data: { status: "CANCELLED" }
      });
    }
  }

  if (input.eventName === "HedgeIntentExpired") {
    const where = intentIdentityWhere(input);
    if (where) {
      await prisma.hedgeIntent.updateMany({
        where,
        data: { status: "EXPIRED" }
      });
    }
  }

  if (input.eventName === "HedgeIntentMatched") {
    const where = intentIdentityWhere(input);
    const data = matchedIntentUpdateData(input.payload);
    if (where && Object.keys(data).length > 0) {
      await prisma.hedgeIntent.updateMany({
        where,
        data
      });
    }
  }

  return { ok: true, status: 201, event: serializeChainEvent(event) };
}

export async function listChainEvents(prisma, query = {}) {
  const limit = Math.max(1, Math.min(50, Number(query.limit ?? 20) || 20));
  const where = {};
  if (query.network) where.network = query.network;
  if (query.contractName) where.contractName = query.contractName;

  const events = await prisma.chainEvent.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: limit
  });

  return { events: events.map(serializeChainEvent) };
}

export async function getDashboard(prisma, query = {}, options = {}) {
  const asset = normalizeAsset(query.asset);
  const now = options.now ?? Date.now();
  const intentBook = await listIntents(prisma, { asset });
  const assetWhere = asset ? { asset } : {};
  const successfulMatchWhere = { ...assetWhere, matchedNotionalUsd: { gt: 0 } };

  const [
    matchAggregate,
    successfulMatchAggregate,
    matchCount,
    successfulMatchCount,
    decisionCount,
    chainEventCount,
    activeIntentCount,
    rejectedDecisionCount,
    latestMatch,
    latestDecision,
    recentEvents
  ] = await Promise.all([
    prisma.hedgeMatch.aggregate({
      where: assetWhere,
      _sum: {
        matchedNotionalUsd: true,
        residualNotionalUsd: true,
        naiveExternalVolumeUsd: true,
        meshExternalVolumeUsd: true,
        externalLiquidityAvoidedUsd: true,
        savedCostUsd: true
      },
      _avg: {
        savedCostBps: true
      }
    }),
    prisma.hedgeMatch.aggregate({
      where: successfulMatchWhere,
      _avg: {
        savedCostBps: true
      }
    }),
    prisma.hedgeMatch.count({ where: assetWhere }),
    prisma.hedgeMatch.count({ where: successfulMatchWhere }),
    prisma.agentDecision.count({ where: assetWhere }),
    prisma.chainEvent.count({ where: { network: query.network ?? "mantle-sepolia" } }),
    prisma.hedgeIntent.count({
      where: {
        ...assetWhere,
        status: { in: ACTIVE_STATUSES }
      }
    }),
    prisma.agentDecision.count({
      where: {
        ...assetWhere,
        decisionType: "REJECT"
      }
    }),
    prisma.hedgeMatch.findFirst({
      where: assetWhere,
      orderBy: [{ createdAt: "desc" }]
    }),
    prisma.agentDecision.findFirst({
      where: assetWhere,
      orderBy: [{ createdAt: "desc" }]
    }),
    prisma.chainEvent.findMany({
      where: { network: query.network ?? "mantle-sepolia" },
      orderBy: [{ createdAt: "desc" }],
      take: 5
    })
  ]);

  const matchedNotionalUsd = decimalToNumber(matchAggregate._sum.matchedNotionalUsd);
  const historicalResidualNotionalUsd = decimalToNumber(matchAggregate._sum.residualNotionalUsd);
  const liveResidualNotionalUsd = intentBook.shortDemandUsd + intentBook.longDemandUsd;
  const naiveExternalVolumeUsd = decimalToNumber(matchAggregate._sum.naiveExternalVolumeUsd);
  const meshExternalVolumeUsd = decimalToNumber(matchAggregate._sum.meshExternalVolumeUsd);
  const externalLiquidityAvoidedUsd = decimalToNumber(matchAggregate._sum.externalLiquidityAvoidedUsd);
  const savedCostUsd = decimalToNumber(matchAggregate._sum.savedCostUsd);
  const internalRateDenominator = matchedNotionalUsd + historicalResidualNotionalUsd;

  return {
    asset: asset ?? "ALL",
    generatedAt: now,
    intentBook,
    totals: {
      intentCount: intentBook.intents.length,
      activeIntentCount,
      matchCount,
      successfulMatchCount,
      decisionCount,
      chainEventCount,
      rejectedDecisionCount,
      matchedNotionalUsd,
      residualNotionalUsd: liveResidualNotionalUsd,
      historicalResidualNotionalUsd,
      residualDirection: getDashboardResidualDirection(
        intentBook.shortDemandUsd,
        intentBook.longDemandUsd
      ),
      internalMatchRate:
        internalRateDenominator === 0 ? 0 : round(matchedNotionalUsd / internalRateDenominator, 4),
      naiveExternalVolumeUsd,
      meshExternalVolumeUsd,
      externalLiquidityAvoidedUsd,
      avgSavedCostBps: round(decimalToNumber(successfulMatchAggregate._avg.savedCostBps), 2),
      savedCostUsd: round(savedCostUsd, 2)
    },
    latestMatch: latestMatch ? serializeMatch(latestMatch) : null,
    latestDecision: latestDecision ? serializeDecision(latestDecision) : null,
    recentEvents: recentEvents.map(serializeChainEvent)
  };
}

export function buildCostComparison(input) {
  const required = [
    "asset",
    "totalShortUsd",
    "totalLongUsd",
    "meshExternalVolumeUsd"
  ];
  const missing = required.filter((field) => input[field] === undefined);
  if (missing.length > 0) {
    return { ok: false, status: 400, errors: missing.map((field) => `${field} is required`) };
  }

  return {
    ok: true,
    status: 200,
    costComparison: compareCosts({
      asset: normalizeAsset(input.asset),
      totalShortUsd: Number(input.totalShortUsd),
      totalLongUsd: Number(input.totalLongUsd),
      meshExternalVolumeUsd: Number(input.meshExternalVolumeUsd),
      naiveExternalVolumeUsd:
        input.naiveExternalVolumeUsd === undefined
          ? undefined
          : Number(input.naiveExternalVolumeUsd),
      residualNotionalUsd:
        input.residualNotionalUsd === undefined ? undefined : Number(input.residualNotionalUsd)
    })
  };
}

function toCoreIntent(intent) {
  return {
    intentId: intent.id,
    user: intent.walletAddress,
    asset: intent.asset,
    direction: intent.direction,
    notionalUsd: Number(intent.notionalUsd),
    durationMinutes: intent.durationMinutes,
    maxCostBps: Number(intent.maxCostBps),
    urgency: intent.urgency,
    status: intent.status,
    filledNotionalUsd: Number(intent.filledNotionalUsd),
    createdAt: intent.createdAt.getTime(),
    expiresAt: intent.expiresAt.getTime()
  };
}

function enrichAllocations(allocations, intents) {
  const byId = new Map(intents.map((intent) => [intent.id, intent]));
  return allocations.map((allocation) => {
    const shortIntent = byId.get(allocation.shortIntentId);
    const longIntent = byId.get(allocation.longIntentId);
    return {
      ...allocation,
      shortUser: shortIntent?.walletAddress ?? null,
      longUser: longIntent?.walletAddress ?? null,
      shortOnchainIntentId: shortIntent?.onchainIntentId ?? null,
      longOnchainIntentId: longIntent?.onchainIntentId ?? null
    };
  });
}

function serializeIntent(intent) {
  return {
    intentId: intent.id,
    user: intent.walletAddress,
    asset: intent.asset,
    direction: intent.direction,
    notionalUsd: Number(intent.notionalUsd),
    durationMinutes: intent.durationMinutes,
    maxCostBps: Number(intent.maxCostBps),
    urgency: intent.urgency,
    status: intent.status,
    filledNotionalUsd: Number(intent.filledNotionalUsd),
    naturalLanguage: intent.naturalLanguage,
    parserConfidence:
      intent.parserConfidence === null || intent.parserConfidence === undefined
        ? null
        : Number(intent.parserConfidence),
    onchainIntentId: intent.onchainIntentId,
    submitTxHash: intent.submitTxHash,
    createdAt: intent.createdAt.getTime(),
    expiresAt: intent.expiresAt.getTime()
  };
}

function serializeMatch(match) {
  return {
    matchId: match.id,
    asset: match.asset,
    matchedNotionalUsd: Number(match.matchedNotionalUsd),
    residualDirection: match.residualDirection,
    residualNotionalUsd: Number(match.residualNotionalUsd),
    naiveExternalVolumeUsd: Number(match.naiveExternalVolumeUsd),
    meshExternalVolumeUsd: Number(match.meshExternalVolumeUsd),
    externalLiquidityAvoidedUsd: Number(match.externalLiquidityAvoidedUsd),
    naiveCostBps: Number(match.naiveCostBps),
    meshCostBps: Number(match.meshCostBps),
    savedCostBps: Number(match.savedCostBps),
    savedCostUsd: Number(match.savedCostUsd),
    onchainMatchId: match.onchainMatchId,
    logTxHash: match.logTxHash,
    createdAt: match.createdAt.getTime()
  };
}

function serializeDecision(decision) {
  return {
    decisionId: decision.id,
    matchId: decision.matchId,
    decisionType: decision.decisionType,
    asset: decision.asset,
    internalMatchUsd: Number(decision.internalMatchUsd),
    residualUsd: Number(decision.residualUsd),
    reason: decision.reason,
    risks: parsePayload(decision.risksJson),
    recommendedAction: decision.recommendedAction,
    txHash: decision.txHash,
    createdAt: decision.createdAt.getTime()
  };
}

function serializeChainEvent(event) {
  return {
    eventId: event.id,
    network: event.network,
    chainId: event.chainId,
    contractName: event.contractName,
    contractAddress: event.contractAddress,
    eventName: event.eventName,
    txHash: event.txHash,
    blockNumber: event.blockNumber,
    payload: parsePayload(event.payloadJson),
    createdAt: event.createdAt.getTime()
  };
}

async function applyFill(tx, intentId, matchedUsd) {
  const intent = await tx.hedgeIntent.findUniqueOrThrow({ where: { id: intentId } });
  const nextFilled = Number(intent.filledNotionalUsd) + matchedUsd;
  const notionalUsd = Number(intent.notionalUsd);
  await tx.hedgeIntent.update({
    where: { id: intentId },
    data: {
      filledNotionalUsd: nextFilled,
      status: nextFilled >= notionalUsd ? "MATCHED" : "PARTIALLY_MATCHED"
    }
  });
}

function remainingDbNotionalUsd(intent) {
  return Math.max(0, Number(intent.notionalUsd) - Number(intent.filledNotionalUsd));
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function decimalToNumber(value) {
  return value === null || value === undefined ? 0 : Number(value);
}

function round(value, decimals) {
  const multiplier = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * multiplier) / multiplier;
}

function getDashboardResidualDirection(shortDemandUsd, longDemandUsd) {
  if (shortDemandUsd > 0 && longDemandUsd > 0) return "MIXED";
  if (shortDemandUsd > 0) return "SHORT";
  if (longDemandUsd > 0) return "LONG";
  return "NONE";
}

function intentIdentityWhere(input) {
  const identity = [];
  if (input.intentId) identity.push({ id: input.intentId });
  if (input.onchainId) identity.push({ onchainIntentId: input.onchainId });
  return identity.length > 0 ? { OR: identity } : null;
}

function matchedIntentUpdateData(payload = {}) {
  const data = {};
  if (payload.filledNotionalUsd !== undefined && payload.filledNotionalUsd !== null) {
    data.filledNotionalUsd = Number(payload.filledNotionalUsd);
  }
  if (payload.status !== undefined && payload.status !== null) {
    const status = ["OPEN", "PARTIALLY_MATCHED", "MATCHED", "CANCELLED", "EXPIRED"][Number(payload.status)];
    if (status) data.status = status;
  }
  return data;
}

function parsePayload(payloadJson) {
  try {
    return JSON.parse(payloadJson);
  } catch {
    return {};
  }
}
