import "dotenv/config";

import { PrismaClient } from "@prisma/client";

import { compareCosts } from "../src/core/cost.js";
import { buildAgentDecision } from "../src/core/decision.js";
import { matchIntents } from "../src/core/matching.js";

const prisma = new PrismaClient();
const NOW = Date.now();
const MATCH_ID = "db_demo_match_mnt";
const DECISION_ID = "db_demo_decision_mnt";

function toCoreIntent(intent) {
  return {
    intentId: intent.id,
    user: intent.walletAddress,
    asset: intent.asset === "METH" ? "mETH" : intent.asset,
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

async function main() {
  const dbIntents = await prisma.hedgeIntent.findMany({
    where: {
      asset: "MNT",
      status: {
        in: ["OPEN", "PARTIALLY_MATCHED"]
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  const matchResult = {
    ...matchIntents(dbIntents.map(toCoreIntent), {
      asset: "MNT",
      now: NOW,
      matchId: MATCH_ID
    }),
    matchId: MATCH_ID
  };
  const costComparison = compareCosts(matchResult);
  const decision = buildAgentDecision(
    {
      asset: "MNT",
      matchResult,
      costComparison,
      maxCostBps: 30,
      urgency: "MEDIUM"
    },
    {
      now: NOW,
      decisionId: DECISION_ID
    }
  );

  await prisma.$transaction(async (tx) => {
    await tx.matchAllocation.deleteMany({ where: { matchId: MATCH_ID } });
    await tx.agentDecision.deleteMany({ where: { id: DECISION_ID } });
    await tx.hedgeMatch.deleteMany({ where: { id: MATCH_ID } });

    await tx.hedgeMatch.create({
      data: {
        id: MATCH_ID,
        asset: "MNT",
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
        createdAt: new Date(NOW)
      }
    });

    for (const allocation of matchResult.allocations) {
      await tx.matchAllocation.create({
        data: {
          id: `${MATCH_ID}:${allocation.shortIntentId}:${allocation.longIntentId}`,
          matchId: MATCH_ID,
          shortIntentId: allocation.shortIntentId,
          longIntentId: allocation.longIntentId,
          matchedUsd: allocation.matchedUsd,
          createdAt: new Date(NOW)
        }
      });

      await tx.hedgeIntent.update({
        where: { id: allocation.shortIntentId },
        data: {
          filledNotionalUsd: {
            increment: allocation.matchedUsd
          },
          status:
            matchResult.residualShortUsd > 0 ? "PARTIALLY_MATCHED" : "MATCHED"
        }
      });

      await tx.hedgeIntent.update({
        where: { id: allocation.longIntentId },
        data: {
          filledNotionalUsd: {
            increment: allocation.matchedUsd
          },
          status:
            matchResult.residualLongUsd > 0 ? "PARTIALLY_MATCHED" : "MATCHED"
        }
      });
    }

    await tx.agentDecision.create({
      data: {
        id: DECISION_ID,
        matchId: MATCH_ID,
        decisionType: decision.decisionType,
        asset: "MNT",
        internalMatchUsd: decision.internalMatchUsd,
        residualUsd: decision.residualUsd,
        reason: decision.reason,
        risksJson: JSON.stringify(decision.risks),
        recommendedAction: decision.recommendedAction,
        createdAt: new Date(NOW)
      }
    });
  });

  console.log(
    JSON.stringify(
      {
        persisted: true,
        matchResult,
        costComparison,
        decision
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
