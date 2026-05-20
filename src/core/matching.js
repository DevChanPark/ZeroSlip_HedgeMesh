import { isActiveIntent, remainingNotionalUsd } from "./model.js";

export function isCompatible(a, b, options = {}) {
  const now = options.now ?? Date.now();
  const durationToleranceMinutes = options.durationToleranceMinutes ?? 15;

  return (
    isActiveIntent(a, now) &&
    isActiveIntent(b, now) &&
    a.asset === b.asset &&
    a.direction !== b.direction &&
    Math.abs(a.durationMinutes - b.durationMinutes) <= durationToleranceMinutes &&
    a.user.toLowerCase() !== b.user.toLowerCase() &&
    a.maxCostBps >= 0 &&
    b.maxCostBps >= 0
  );
}

export function matchIntents(intents, options = {}) {
  const now = options.now ?? Date.now();
  const asset = options.asset;
  const matchId = options.matchId ?? `match_${asset ?? "ALL"}_${now}`;

  const active = intents
    .filter((intent) => isActiveIntent(intent, now))
    .filter((intent) => !asset || intent.asset === asset);

  const shorts = active.filter((intent) => intent.direction === "SHORT");
  const longs = active.filter((intent) => intent.direction === "LONG");
  const remaining = new Map(active.map((intent) => [intent.intentId, remainingNotionalUsd(intent)]));
  const allocations = [];

  for (const shortIntent of shorts) {
    for (const longIntent of longs) {
      const shortRemaining = remaining.get(shortIntent.intentId) ?? 0;
      const longRemaining = remaining.get(longIntent.intentId) ?? 0;

      if (shortRemaining <= 0 || longRemaining <= 0) continue;
      if (!isCompatible(shortIntent, longIntent, { ...options, now })) continue;

      const matchedUsd = Math.min(shortRemaining, longRemaining);
      allocations.push({
        shortIntentId: shortIntent.intentId,
        longIntentId: longIntent.intentId,
        asset: shortIntent.asset,
        matchedUsd
      });
      remaining.set(shortIntent.intentId, shortRemaining - matchedUsd);
      remaining.set(longIntent.intentId, longRemaining - matchedUsd);
    }
  }

  const totalShortUsd = sum(shorts.map(remainingNotionalUsd));
  const totalLongUsd = sum(longs.map(remainingNotionalUsd));
  const matchedNotionalUsd = sum(allocations.map((allocation) => allocation.matchedUsd));
  const residualShortUsd = sum(shorts.map((intent) => remaining.get(intent.intentId) ?? 0));
  const residualLongUsd = sum(longs.map((intent) => remaining.get(intent.intentId) ?? 0));
  const meshExternalVolumeUsd = residualShortUsd + residualLongUsd;
  const naiveExternalVolumeUsd = totalShortUsd + totalLongUsd;

  return {
    matchId,
    asset: asset ?? active[0]?.asset ?? "UNKNOWN",
    shortIntentIds: shorts.map((intent) => intent.intentId),
    longIntentIds: longs.map((intent) => intent.intentId),
    allocations,
    totalShortUsd,
    totalLongUsd,
    matchedNotionalUsd,
    residualDirection: getResidualDirection(residualShortUsd, residualLongUsd),
    residualNotionalUsd: meshExternalVolumeUsd,
    residualShortUsd,
    residualLongUsd,
    meshExternalVolumeUsd,
    naiveExternalVolumeUsd,
    internalMatchRate:
      Math.max(totalShortUsd, totalLongUsd) === 0
        ? 0
        : matchedNotionalUsd / Math.max(totalShortUsd, totalLongUsd),
    createdAt: now
  };
}

function getResidualDirection(residualShortUsd, residualLongUsd) {
  if (residualShortUsd > 0 && residualLongUsd > 0) return "MIXED";
  if (residualShortUsd > 0) return "SHORT";
  if (residualLongUsd > 0) return "LONG";
  return "NONE";
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

