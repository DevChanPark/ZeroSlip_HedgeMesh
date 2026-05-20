import { createIntent } from "./model.js";

export function buildDemoIntents(now = Date.now()) {
  return [
    createIntent(
      {
        user: "0xA000000000000000000000000000000000000001",
        asset: "MNT",
        direction: "SHORT",
        notionalUsd: 10_000,
        durationMinutes: 60,
        maxCostBps: 30,
        urgency: "MEDIUM"
      },
      { intentId: "intent_short_mnt_10000", createdAt: now, expiresAt: now + 60 * 60_000 }
    ),
    createIntent(
      {
        user: "0xB000000000000000000000000000000000000002",
        asset: "MNT",
        direction: "LONG",
        notionalUsd: 7_000,
        durationMinutes: 60,
        maxCostBps: 30,
        urgency: "MEDIUM"
      },
      { intentId: "intent_long_mnt_7000", createdAt: now, expiresAt: now + 60 * 60_000 }
    )
  ];
}

