-- CreateTable
CREATE TABLE "HedgeIntent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletAddress" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "notionalUsd" DECIMAL NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "maxCostBps" DECIMAL NOT NULL,
    "urgency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "filledNotionalUsd" DECIMAL NOT NULL DEFAULT 0,
    "naturalLanguage" TEXT,
    "parserConfidence" DECIMAL,
    "onchainIntentId" TEXT,
    "submitTxHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "HedgeMatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "asset" TEXT NOT NULL,
    "matchedNotionalUsd" DECIMAL NOT NULL,
    "residualDirection" TEXT NOT NULL,
    "residualNotionalUsd" DECIMAL NOT NULL,
    "naiveExternalVolumeUsd" DECIMAL NOT NULL,
    "meshExternalVolumeUsd" DECIMAL NOT NULL,
    "externalLiquidityAvoidedUsd" DECIMAL NOT NULL,
    "naiveCostBps" DECIMAL NOT NULL,
    "meshCostBps" DECIMAL NOT NULL,
    "savedCostBps" DECIMAL NOT NULL,
    "savedCostUsd" DECIMAL NOT NULL,
    "onchainMatchId" TEXT,
    "logTxHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MatchAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT NOT NULL,
    "shortIntentId" TEXT NOT NULL,
    "longIntentId" TEXT NOT NULL,
    "matchedUsd" DECIMAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MatchAllocation_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "HedgeMatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MatchAllocation_shortIntentId_fkey" FOREIGN KEY ("shortIntentId") REFERENCES "HedgeIntent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MatchAllocation_longIntentId_fkey" FOREIGN KEY ("longIntentId") REFERENCES "HedgeIntent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT,
    "decisionType" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "internalMatchUsd" DECIMAL NOT NULL,
    "residualUsd" DECIMAL NOT NULL,
    "reason" TEXT NOT NULL,
    "risksJson" TEXT NOT NULL,
    "recommendedAction" TEXT NOT NULL,
    "txHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentDecision_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "HedgeMatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChainDeployment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "network" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractName" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "deployTxHash" TEXT NOT NULL,
    "deployerAddress" TEXT NOT NULL,
    "explorerUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ChainEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "network" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractName" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "blockNumber" INTEGER,
    "payloadJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "HedgeIntent_asset_direction_status_idx" ON "HedgeIntent"("asset", "direction", "status");

-- CreateIndex
CREATE INDEX "HedgeIntent_walletAddress_idx" ON "HedgeIntent"("walletAddress");

-- CreateIndex
CREATE INDEX "HedgeIntent_expiresAt_idx" ON "HedgeIntent"("expiresAt");

-- CreateIndex
CREATE INDEX "HedgeMatch_asset_createdAt_idx" ON "HedgeMatch"("asset", "createdAt");

-- CreateIndex
CREATE INDEX "MatchAllocation_matchId_idx" ON "MatchAllocation"("matchId");

-- CreateIndex
CREATE INDEX "MatchAllocation_shortIntentId_idx" ON "MatchAllocation"("shortIntentId");

-- CreateIndex
CREATE INDEX "MatchAllocation_longIntentId_idx" ON "MatchAllocation"("longIntentId");

-- CreateIndex
CREATE INDEX "AgentDecision_asset_createdAt_idx" ON "AgentDecision"("asset", "createdAt");

-- CreateIndex
CREATE INDEX "AgentDecision_decisionType_idx" ON "AgentDecision"("decisionType");

-- CreateIndex
CREATE INDEX "ChainDeployment_chainId_idx" ON "ChainDeployment"("chainId");

-- CreateIndex
CREATE UNIQUE INDEX "ChainDeployment_network_contractName_key" ON "ChainDeployment"("network", "contractName");

-- CreateIndex
CREATE INDEX "ChainEvent_network_eventName_idx" ON "ChainEvent"("network", "eventName");

-- CreateIndex
CREATE INDEX "ChainEvent_txHash_idx" ON "ChainEvent"("txHash");

