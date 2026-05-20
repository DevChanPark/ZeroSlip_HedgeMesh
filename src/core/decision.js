export function buildAgentDecision(input, options = {}) {
  const now = options.now ?? Date.now();
  const decisionId = options.decisionId ?? `decision_${input.asset}_${now}`;
  const maxCostBps = options.maxCostBps ?? input.maxCostBps ?? Number.POSITIVE_INFINITY;
  const urgency = options.urgency ?? input.urgency ?? "MEDIUM";
  const matchedUsd = input.matchResult.matchedNotionalUsd;
  const residualUsd = input.matchResult.meshExternalVolumeUsd;
  const residualCostBps = input.costComparison.residualExternalCostBps;

  let decisionType = "REJECT";
  if (matchedUsd > 0) {
    decisionType = "MATCH";
  } else if (residualUsd > 0 && residualCostBps <= maxCostBps && urgency === "HIGH") {
    decisionType = "ROUTE_EXTERNAL";
  } else if (residualUsd > 0) {
    decisionType = "WAIT";
  }

  return {
    decisionId,
    decisionType,
    asset: input.asset,
    internalMatchUsd: matchedUsd,
    residualUsd,
    reason: buildReason(decisionType, input.matchResult, input.costComparison),
    risks: buildRisks(decisionType, input.matchResult, residualCostBps, maxCostBps),
    recommendedAction: buildRecommendedAction(decisionType, residualUsd),
    createdAt: now
  };
}

function buildReason(decisionType, matchResult, costComparison) {
  if (decisionType === "MATCH") {
    return `Matched $${formatUsd(matchResult.matchedNotionalUsd)} of opposite ${matchResult.asset} hedge intents internally. External volume falls from $${formatUsd(costComparison.naiveExternalVolumeUsd)} to $${formatUsd(costComparison.meshExternalVolumeUsd)}, saving about ${costComparison.savedCostBps} bps.`;
  }

  if (decisionType === "ROUTE_EXTERNAL") {
    return `No compatible internal match is available, but residual external cost is within the user's max cost constraint. Route the residual hedge in simulation mode.`;
  }

  if (decisionType === "WAIT") {
    return `No compatible internal match is available yet, or external routing is not attractive under the current cost constraints. Keep the intent open for more opposite demand.`;
  }

  return "The intent should be rejected because it failed validation or cannot be routed safely.";
}

function buildRisks(decisionType, matchResult, residualCostBps, maxCostBps) {
  const risks = [];

  if (matchResult.meshExternalVolumeUsd > 0) {
    risks.push("Residual hedge exposure remains unmatched");
    risks.push("External quote may change before execution");
  }

  if (residualCostBps > maxCostBps) {
    risks.push("Estimated external hedge cost exceeds the user's maxCostBps");
  }

  if (decisionType === "WAIT") {
    risks.push("Opposite hedge demand may not arrive before expiry");
  }

  if (risks.length === 0) {
    risks.push("Synthetic settlement and collateral are simulated in the MVP");
  }

  return risks;
}

function buildRecommendedAction(decisionType, residualUsd) {
  if (decisionType === "MATCH" && residualUsd > 0) {
    return "Log match and simulate residual route";
  }
  if (decisionType === "MATCH") return "Log full internal match";
  if (decisionType === "ROUTE_EXTERNAL") return "Simulate external residual route";
  if (decisionType === "WAIT") return "Wait for compatible opposite intent";
  return "Ask user to revise intent";
}

function formatUsd(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

