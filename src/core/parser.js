import { normalizeAsset, validateIntentDraft } from "./model.js";

const ASSET_PATTERNS = [
  ["MNT", /\bMNT\b|엠엔티/i],
  ["mETH", /\bmETH\b|\bMETH\b|메스|엠이더/i],
  ["USDC", /\bUSDC\b|유에스디씨/i]
];

export function parseNaturalLanguageIntent(text) {
  const source = String(text ?? "");

  const asset = detectAsset(source);
  const direction = detectDirection(source);
  const notionalUsd = detectNotionalUsd(source);
  const durationMinutes = detectDurationMinutes(source);
  const maxCostBps = detectMaxCostBps(source);
  const urgency = detectUrgency(source);

  const fieldHits = [asset, direction, notionalUsd, durationMinutes, maxCostBps, urgency].filter(
    (value) => value !== null && value !== undefined
  ).length;

  const draft = {
    asset,
    direction,
    notionalUsd,
    durationMinutes,
    maxCostBps: maxCostBps ?? 15,
    urgency
  };

  const validation = validateIntentDraft(draft);

  return {
    ...draft,
    confidence: Number((fieldHits / 6).toFixed(2)),
    requiresManualReview: !validation.ok || fieldHits < 5,
    errors: validation.errors
  };
}

function detectAsset(text) {
  for (const [asset, pattern] of ASSET_PATTERNS) {
    if (pattern.test(text)) return normalizeAsset(asset);
  }
  return null;
}

function detectDirection(text) {
  const lower = text.toLowerCase();

  if (/하락|떨어|손실|downside|fall|drop|drawdown|long exposure/.test(lower)) {
    return "SHORT";
  }

  if (/상승|오를|오르|upside|rise|short exposure|short 포지션|숏 노출/.test(lower)) {
    return "LONG";
  }

  return null;
}

function detectNotionalUsd(text) {
  const patterns = [
    /\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)/,
    /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:달러|usd|USDC|불)/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1].replaceAll(",", ""));
  }

  return null;
}

function detectDurationMinutes(text) {
  const hourMatch = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:시간|hour|hours|hr|h)/i);
  if (hourMatch) return Number(hourMatch[1]) * 60;

  const minuteMatch = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:분|minute|minutes|min|m)/i);
  if (minuteMatch) return Number(minuteMatch[1]);

  return null;
}

function detectMaxCostBps(text) {
  const match = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:bps|bp|비피)/i);
  return match ? Number(match[1]) : null;
}

function detectUrgency(text) {
  if (/천천히|기다|낮음|low|not urgent/i.test(text)) return "LOW";
  if (/급해|즉시|바로|높음|urgent|high|asap/i.test(text)) return "HIGH";
  return "MEDIUM";
}
