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

function parsePayload(payloadJson) {
  try {
    return JSON.parse(payloadJson);
  } catch {
    return {};
  }
}
