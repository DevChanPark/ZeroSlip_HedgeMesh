import "dotenv/config";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const mode = process.argv.includes("--golden") ? "golden" : "counterparty";
const now = new Date();
const expiresAt = new Date(now.getTime() + 4 * 60 * 60 * 1000);

const fixtures = [
  {
    id: "demo_agent_long_mnt_7000",
    walletAddress: "0xB000000000000000000000000000000000000002",
    asset: "MNT",
    direction: "LONG",
    notionalUsd: 7000,
    durationMinutes: 60,
    maxCostBps: 30,
    urgency: "MEDIUM",
    status: "OPEN",
    filledNotionalUsd: 0,
    naturalLanguage: "Agent counterparty wants a $7,000 MNT long hedge for 1 hour.",
    parserConfidence: 1,
    createdAt: now,
    expiresAt
  }
];

if (mode === "golden") {
  fixtures.unshift({
    id: "demo_trader_short_mnt_10000",
    walletAddress: "0xA000000000000000000000000000000000000001",
    asset: "MNT",
    direction: "SHORT",
    notionalUsd: 10000,
    durationMinutes: 60,
    maxCostBps: 30,
    urgency: "MEDIUM",
    status: "OPEN",
    filledNotionalUsd: 0,
    naturalLanguage: "Trader wants to hedge $10,000 of MNT downside risk for 1 hour.",
    parserConfidence: 1,
    createdAt: now,
    expiresAt
  });
}

async function main() {
  await prisma.$transaction(async (tx) => {
    await tx.chainEvent.deleteMany();
    await tx.agentDecision.deleteMany();
    await tx.matchAllocation.deleteMany();
    await tx.hedgeMatch.deleteMany();
    await tx.hedgeIntent.deleteMany();

    for (const fixture of fixtures) {
      await tx.hedgeIntent.create({ data: fixture });
    }
  });

  console.log(
    JSON.stringify(
      {
        reset: true,
        mode,
        seededIntents: fixtures.map((intent) => ({
          id: intent.id,
          direction: intent.direction,
          asset: intent.asset,
          notionalUsd: intent.notionalUsd,
          expiresAt: intent.expiresAt.toISOString()
        })),
        nextStep:
          mode === "golden"
            ? "Run the web console and press Run Matching to show the 70% internal match KPI."
            : "Submit a $10,000 SHORT MNT wallet intent, then run matching against the seeded $7,000 LONG counterparty."
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
