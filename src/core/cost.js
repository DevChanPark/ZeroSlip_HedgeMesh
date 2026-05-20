export function estimateExternalCostBps(volumeUsd) {
  if (!Number.isFinite(volumeUsd) || volumeUsd <= 0) return 0;

  const baseFeeBps = 6;
  const spreadAndGasBps = 3;
  const marketImpactBps = volumeUsd / 1000;

  return roundBps(baseFeeBps + spreadAndGasBps + marketImpactBps);
}

export function compareCosts(input, options = {}) {
  const internalCostBps = options.internalCostBps ?? 2;
  const residualRouteOverheadBps = options.residualRouteOverheadBps ?? 1;
  const naiveExternalVolumeUsd =
    input.naiveExternalVolumeUsd ?? input.totalShortUsd + input.totalLongUsd;
  const meshExternalVolumeUsd = input.meshExternalVolumeUsd ?? input.residualNotionalUsd;
  const externalLiquidityAvoidedUsd = Math.max(
    0,
    naiveExternalVolumeUsd - meshExternalVolumeUsd
  );

  const naiveCostBps = estimateExternalCostBps(naiveExternalVolumeUsd);
  const residualExternalCostBps = estimateExternalCostBps(meshExternalVolumeUsd);
  const protectedNotionalUsd = Math.max(input.totalShortUsd, input.totalLongUsd, 1);

  const meshCostBps =
    meshExternalVolumeUsd === 0
      ? internalCostBps
      : roundBps(
          internalCostBps +
            residualRouteOverheadBps +
            residualExternalCostBps * (meshExternalVolumeUsd / protectedNotionalUsd)
        );
  const savedCostBps = roundBps(Math.max(0, naiveCostBps - meshCostBps));
  const savedCostUsd = roundUsd((savedCostBps / 10_000) * protectedNotionalUsd);

  return {
    asset: input.asset,
    naiveExternalVolumeUsd,
    meshExternalVolumeUsd,
    externalLiquidityAvoidedUsd,
    naiveCostBps,
    meshCostBps,
    savedCostBps,
    savedCostUsd,
    residualExternalCostBps,
    internalCostBps
  };
}

function roundBps(value) {
  return Math.round(value * 10) / 10;
}

function roundUsd(value) {
  return Math.round(value * 100) / 100;
}

