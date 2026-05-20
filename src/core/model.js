export const SUPPORTED_ASSETS = ["MNT", "mETH", "USDC"];
export const DIRECTIONS = ["LONG", "SHORT"];
export const URGENCY_LEVELS = ["LOW", "MEDIUM", "HIGH"];
export const ACTIVE_STATUSES = ["OPEN", "PARTIALLY_MATCHED"];

export function normalizeAsset(asset) {
  if (!asset) return null;
  const normalized = String(asset).trim();
  const upper = normalized.toUpperCase();

  if (upper === "METH") return "mETH";
  if (upper === "MNT") return "MNT";
  if (upper === "USDC") return "USDC";

  return null;
}

export function isSupportedAsset(asset) {
  return SUPPORTED_ASSETS.includes(normalizeAsset(asset));
}

export function remainingNotionalUsd(intent) {
  return Math.max(0, intent.notionalUsd - (intent.filledNotionalUsd ?? 0));
}

export function isActiveIntent(intent, now = Date.now()) {
  return (
    ACTIVE_STATUSES.includes(intent.status) &&
    remainingNotionalUsd(intent) > 0 &&
    intent.expiresAt > now &&
    isSupportedAsset(intent.asset)
  );
}

export function validateIntentDraft(draft) {
  const errors = [];
  const asset = normalizeAsset(draft.asset);

  if (!asset) errors.push("unsupported asset");
  if (!DIRECTIONS.includes(draft.direction)) errors.push("invalid direction");
  if (!Number.isFinite(draft.notionalUsd) || draft.notionalUsd <= 0) {
    errors.push("notionalUsd must be positive");
  }
  if (!Number.isFinite(draft.durationMinutes) || draft.durationMinutes <= 0) {
    errors.push("durationMinutes must be positive");
  }
  if (!Number.isFinite(draft.maxCostBps) || draft.maxCostBps < 0) {
    errors.push("maxCostBps must be non-negative");
  }
  if (!URGENCY_LEVELS.includes(draft.urgency)) errors.push("invalid urgency");

  return {
    ok: errors.length === 0,
    errors,
    value: errors.length
      ? null
      : {
          ...draft,
          asset,
          notionalUsd: Number(draft.notionalUsd),
          durationMinutes: Number(draft.durationMinutes),
          maxCostBps: Number(draft.maxCostBps)
        }
  };
}

export function createIntent(draft, options = {}) {
  const validation = validateIntentDraft(draft);
  if (!validation.ok) {
    throw new Error(`Invalid intent: ${validation.errors.join(", ")}`);
  }

  const createdAt = options.createdAt ?? Date.now();
  const intentId =
    options.intentId ??
    `intent_${validation.value.asset}_${createdAt}_${Math.random().toString(16).slice(2, 8)}`;

  return {
    intentId,
    user: draft.user,
    ...validation.value,
    status: options.status ?? "OPEN",
    filledNotionalUsd: options.filledNotionalUsd ?? 0,
    createdAt,
    expiresAt: options.expiresAt ?? createdAt + validation.value.durationMinutes * 60_000
  };
}

