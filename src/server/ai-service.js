import { buildAgentDecision } from "../core/decision.js";
import { normalizeAsset, validateIntentDraft } from "../core/model.js";
import { parseNaturalLanguageIntent } from "../core/parser.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 12_000;

const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "asset",
    "direction",
    "notionalUsd",
    "durationMinutes",
    "maxCostBps",
    "urgency",
    "confidence",
    "requiresManualReview",
    "errors"
  ],
  properties: {
    asset: { type: "string", enum: ["MNT", "mETH", "USDC", "UNKNOWN"] },
    direction: { type: "string", enum: ["LONG", "SHORT", "UNKNOWN"] },
    notionalUsd: { type: "number" },
    durationMinutes: { type: "number" },
    maxCostBps: { type: "number" },
    urgency: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
    confidence: { type: "number" },
    requiresManualReview: { type: "boolean" },
    errors: {
      type: "array",
      items: { type: "string" }
    }
  }
};

const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "reason", "risks", "recommendedAction"],
  properties: {
    summary: { type: "string" },
    reason: { type: "string" },
    risks: {
      type: "array",
      items: { type: "string" }
    },
    recommendedAction: { type: "string" }
  }
};

export async function parseIntentWithAiFallback(text, options = {}) {
  const fallback = {
    ...parseNaturalLanguageIntent(text),
    aiSource: "deterministic"
  };

  if (!getOpenAiApiKey(options)) return fallback;

  try {
    const parsed = await callOpenAiJson({
      schemaName: "hedge_intent",
      schema: INTENT_SCHEMA,
      system:
        "You parse hedge intent text into strict JSON. Supported assets are MNT, mETH, and USDC. A user hedging downside risk on a long exposure wants SHORT. A user hedging upside risk on a short exposure wants LONG. Do not invent missing amount or duration; use UNKNOWN or 0 and require manual review.",
      user: `Parse this hedge intent into JSON:\n\n${String(text ?? "")}`,
      options
    });
    return normalizeAiIntent(parsed, fallback);
  } catch (error) {
    return {
      ...fallback,
      aiError: safeAiError(error)
    };
  }
}

export async function buildAgentDecisionWithAiFallback(input, options = {}) {
  const deterministic = {
    ...buildAgentDecision(input, options),
    aiSource: "deterministic"
  };

  if (!getOpenAiApiKey(options)) return deterministic;

  try {
    const explanation = await callOpenAiJson({
      schemaName: "hedge_decision_explanation",
      schema: DECISION_SCHEMA,
      system:
        "You explain deterministic hedge matching decisions in concise product language. Do not change the decision type or numeric calculations. Mention internal netting, residual exposure, and relevant risk controls when applicable.",
      user: JSON.stringify(
        {
          deterministicDecision: deterministic,
          matchResult: input.matchResult,
          costComparison: input.costComparison,
          constraints: {
            maxCostBps: input.maxCostBps,
            urgency: input.urgency
          }
        },
        null,
        2
      ),
      options
    });

    return {
      ...deterministic,
      reason: nonEmptyString(explanation.reason) ?? deterministic.reason,
      risks: Array.isArray(explanation.risks) && explanation.risks.length > 0
        ? explanation.risks.map(String).slice(0, 5)
        : deterministic.risks,
      recommendedAction: nonEmptyString(explanation.recommendedAction) ?? deterministic.recommendedAction,
      summary: nonEmptyString(explanation.summary) ?? undefined,
      aiSource: "openai"
    };
  } catch (error) {
    return {
      ...deterministic,
      aiError: safeAiError(error)
    };
  }
}

async function callOpenAiJson({ options = {}, schema, schemaName, system, user }) {
  const apiKey = getOpenAiApiKey(options);
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(options.timeoutMs ?? process.env.OPENAI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS)
  );

  try {
    const response = await (options.fetch ?? fetch)(options.url ?? OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL,
        input: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        text: {
          format: {
            type: "json_schema",
            name: schemaName,
            strict: true,
            schema
          }
        }
      }),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error?.message ?? `OpenAI request failed with HTTP ${response.status}`);
    }

    const text = extractResponseText(payload);
    if (!text) throw new Error("OpenAI response did not include output text");
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeAiIntent(parsed, fallback) {
  const candidate = {
    asset: parsed.asset === "UNKNOWN" ? null : normalizeAsset(parsed.asset),
    direction: parsed.direction === "UNKNOWN" ? null : parsed.direction,
    notionalUsd: positiveNumberOrNull(parsed.notionalUsd),
    durationMinutes: positiveNumberOrNull(parsed.durationMinutes),
    maxCostBps: nonNegativeNumberOrDefault(parsed.maxCostBps, fallback.maxCostBps ?? 15),
    urgency: ["LOW", "MEDIUM", "HIGH"].includes(parsed.urgency) ? parsed.urgency : "MEDIUM"
  };
  const validation = validateIntentDraft(candidate);
  const errors = [...new Set([...(parsed.errors ?? []), ...validation.errors].map(String))];

  return {
    ...candidate,
    confidence: clampConfidence(parsed.confidence ?? fallback.confidence),
    requiresManualReview: Boolean(parsed.requiresManualReview) || !validation.ok,
    errors,
    aiSource: "openai"
  };
}

function extractResponseText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;

  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") return content.text;
    }
  }

  return null;
}

function getOpenAiApiKey(options) {
  return options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
}

function positiveNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nonNegativeNumberOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, Number(number.toFixed(2))));
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeAiError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/api key|authorization|bearer|sk-[a-z0-9_-]+/i.test(message)) {
    return "OpenAI request failed; deterministic fallback used";
  }
  return message.replace(/sk-[a-z0-9_-]+/gi, "[redacted]");
}
