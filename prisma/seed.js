import "dotenv/config";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const now = new Date();
const expiresAt = new Date(now.getTime() + 4 * 60 * 60 * 1000);

async function main() {
  await prisma.hedgeIntent.upsert({
    where: { id: "intent_short_mnt_10000" },
    update: {
      status: "OPEN",
      filledNotionalUsd: 0,
      submitTxHash: null,
      onchainIntentId: null,
      expiresAt
    },
    create: {
      id: "intent_short_mnt_10000",
      walletAddress: "0xA000000000000000000000000000000000000001",
      asset: "MNT",
      direction: "SHORT",
      notionalUsd: 10000,
      durationMinutes: 60,
      maxCostBps: 30,
      urgency: "MEDIUM",
      status: "OPEN",
      filledNotionalUsd: 0,
      naturalLanguage: "MNT 10,000달러 하락 리스크를 1시간 동안 헷지하고 싶다.",
      parserConfidence: 1,
      createdAt: now,
      expiresAt
    }
  });

  await prisma.hedgeIntent.upsert({
    where: { id: "intent_long_mnt_7000" },
    update: {
      status: "OPEN",
      filledNotionalUsd: 0,
      submitTxHash: null,
      onchainIntentId: null,
      expiresAt
    },
    create: {
      id: "intent_long_mnt_7000",
      walletAddress: "0xB000000000000000000000000000000000000002",
      asset: "MNT",
      direction: "LONG",
      notionalUsd: 7000,
      durationMinutes: 60,
      maxCostBps: 30,
      urgency: "MEDIUM",
      status: "OPEN",
      filledNotionalUsd: 0,
      naturalLanguage: "MNT 7,000달러 상승 리스크를 1시간 동안 헷지하고 싶다.",
      parserConfidence: 1,
      createdAt: now,
      expiresAt
    }
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
