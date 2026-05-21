"use client";

import {
  Activity,
  Database,
  GitBranch,
  RefreshCw,
  Send,
  ShieldCheck,
  Wallet,
  Wand2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, useConnect, useDisconnect, usePublicClient, useSendTransaction, useSwitchChain } from "wagmi";
import { encodeFunctionData, parseEventLogs } from "viem";

import { mantleSepolia } from "./providers";

type Direction = "LONG" | "SHORT";
type Urgency = "LOW" | "MEDIUM" | "HIGH";

type HedgeIntentDraft = {
  asset: "MNT" | "mETH" | "USDC";
  direction: Direction;
  notionalUsd: number;
  durationMinutes: number;
  maxCostBps: number;
  urgency: Urgency;
};

type ParsedIntent = HedgeIntentDraft & {
  confidence?: number;
};

type HedgeIntent = HedgeIntentDraft & {
  intentId: string;
  user: string;
  status: string;
  filledNotionalUsd: number;
  onchainIntentId?: string | null;
  submitTxHash?: string | null;
};

type IntentBook = {
  shortDemandUsd: number;
  longDemandUsd: number;
  intents: HedgeIntent[];
};

type MatchResponse = {
  matchResult: {
    matchId: string;
    asset: string;
    matchedNotionalUsd: number;
    residualDirection: string;
    residualNotionalUsd: number;
    internalMatchRate: number;
  };
  costComparison: {
    externalLiquidityAvoidedUsd: number;
    naiveCostBps: number;
    meshCostBps: number;
    savedCostBps: number;
  };
  decision: {
    decisionId: string;
    decisionType: string;
    internalMatchUsd: number;
    residualUsd: number;
    reason: string;
    risks: string[];
  };
};

type ChainEvent = {
  eventId: string;
  eventName: string;
  contractName: string;
  txHash: string;
  blockNumber?: number | null;
  payload?: Record<string, unknown>;
  createdAt: number;
};

const CONTRACTS = {
  intentBook: "0x7489039281b77aab0ef24f56e333f28cfc352ee9" as const,
  matchLog: "0xc02797d86f47ac6757383039b4bb5c2d9fe4e3cc" as const
};

const EXPLORER = "https://explorer.sepolia.mantle.xyz";

const intentBookAbi = [
  {
    type: "function",
    name: "submitIntent",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "string" },
      { name: "direction", type: "string" },
      { name: "notionalUsd", type: "uint256" },
      { name: "durationMinutes", type: "uint256" },
      { name: "maxCostBps", type: "uint256" },
      { name: "urgency", type: "string" }
    ],
    outputs: [{ name: "intentId", type: "bytes32" }]
  },
  {
    type: "event",
    name: "HedgeIntentSubmitted",
    inputs: [
      { indexed: true, name: "intentId", type: "bytes32" },
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "asset", type: "string" },
      { indexed: false, name: "direction", type: "string" },
      { indexed: false, name: "notionalUsd", type: "uint256" },
      { indexed: false, name: "durationMinutes", type: "uint256" },
      { indexed: false, name: "maxCostBps", type: "uint256" },
      { indexed: false, name: "createdAt", type: "uint256" },
      { indexed: false, name: "expiresAt", type: "uint256" }
    ]
  }
] as const;

const matchLogAbi = [
  {
    type: "function",
    name: "logMatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matchId", type: "bytes32" },
      { name: "asset", type: "string" },
      { name: "matchedNotionalUsd", type: "uint256" },
      { name: "residualNotionalUsd", type: "uint256" },
      { name: "estimatedSavingsBps", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "logAgentDecision",
    stateMutability: "nonpayable",
    inputs: [
      { name: "decisionId", type: "bytes32" },
      { name: "decisionType", type: "string" },
      { name: "internalMatchUsd", type: "uint256" },
      { name: "residualUsd", type: "uint256" },
      { name: "estimatedSavingsBps", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "event",
    name: "HedgeMatched",
    inputs: [
      { indexed: true, name: "matchId", type: "bytes32" },
      { indexed: false, name: "asset", type: "string" },
      { indexed: false, name: "matchedNotionalUsd", type: "uint256" },
      { indexed: false, name: "residualNotionalUsd", type: "uint256" },
      { indexed: false, name: "estimatedSavingsBps", type: "uint256" },
      { indexed: false, name: "createdAt", type: "uint256" }
    ]
  },
  {
    type: "event",
    name: "AgentDecisionLogged",
    inputs: [
      { indexed: true, name: "decisionId", type: "bytes32" },
      { indexed: false, name: "decisionType", type: "string" },
      { indexed: false, name: "internalMatchUsd", type: "uint256" },
      { indexed: false, name: "residualUsd", type: "uint256" },
      { indexed: false, name: "estimatedSavingsBps", type: "uint256" },
      { indexed: false, name: "createdAt", type: "uint256" }
    ]
  }
] as const;

const initialDraft: HedgeIntentDraft = {
  asset: "MNT",
  direction: "SHORT",
  notionalUsd: 1000,
  durationMinutes: 60,
  maxCostBps: 10,
  urgency: "MEDIUM"
};

export default function HomePage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectAsync, connectors, status: connectStatus } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const publicClient = usePublicClient({ chainId: mantleSepolia.id });

  const [naturalLanguage, setNaturalLanguage] = useState(
    "I want to hedge $1,000 of MNT downside risk for 1 hour. Keep cost under 10 bps."
  );
  const [draft, setDraft] = useState<HedgeIntentDraft>(initialDraft);
  const [parsed, setParsed] = useState<ParsedIntent | null>(null);
  const [book, setBook] = useState<IntentBook>({ shortDemandUsd: 0, longDemandUsd: 0, intents: [] });
  const [latestMatch, setLatestMatch] = useState<MatchResponse | null>(null);
  const [events, setEvents] = useState<ChainEvent[]>([]);
  const [intentOutput, setIntentOutput] = useState("Ready.");
  const [chainOutput, setChainOutput] = useState("No chain log yet.");
  const [busy, setBusy] = useState<string | null>(null);

  const isConnecting = connectStatus === "pending";
  const networkLabel = chainId === mantleSepolia.id ? "Mantle Sepolia" : "Wrong network";
  const connectedLabel = isConnected && address ? shortAddress(address) : "No wallet";
  const metrics = useMemo(
    () => ({
      internalMatch: latestMatch?.matchResult.matchedNotionalUsd ?? 0,
      residual: latestMatch?.matchResult.residualNotionalUsd ?? 0,
      residualDirection: latestMatch?.matchResult.residualDirection ?? "NONE",
      avoided: latestMatch?.costComparison.externalLiquidityAvoidedUsd ?? 0,
      saved: latestMatch?.costComparison.savedCostBps ?? 0
    }),
    [latestMatch]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadInitial(attempt = 0) {
      try {
        await Promise.all([refreshBook(), refreshEvents()]);
      } catch (error) {
        if (cancelled) return;
        if (attempt < 3) {
          window.setTimeout(() => loadInitial(attempt + 1), 500);
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setIntentOutput(JSON.stringify({ error: message }, null, 2));
      }
    }

    loadInitial();
    return () => {
      cancelled = true;
    };
  }, []);

  async function connectWallet() {
    await runBusy("wallet", async () => {
      const connector = connectors[0];
      if (!connector) throw new Error("No injected wallet connector found");
      await connectAsync({ connector, chainId: mantleSepolia.id });
    });
  }

  async function ensureMantleSepolia() {
    if (chainId !== mantleSepolia.id && switchChainAsync) {
      await switchChainAsync({ chainId: mantleSepolia.id });
    }
  }

  async function parseIntent() {
    await runBusy("parse", async () => {
      const result = await api<ParsedIntent>("/api/intent/parse", {
        method: "POST",
        body: { text: naturalLanguage }
      });
      const nextDraft = {
        asset: result.asset ?? draft.asset,
        direction: result.direction ?? draft.direction,
        notionalUsd: result.notionalUsd ?? draft.notionalUsd,
        durationMinutes: result.durationMinutes ?? draft.durationMinutes,
        maxCostBps: result.maxCostBps ?? draft.maxCostBps,
        urgency: result.urgency ?? draft.urgency
      } as HedgeIntentDraft;
      setParsed(result);
      setDraft(nextDraft);
      setIntentOutput(JSON.stringify(result, null, 2));
    });
  }

  async function submitIntent() {
    await runBusy("submit", async () => {
      if (!address) throw new Error("Connect wallet first");
      if (!publicClient) throw new Error("Mantle Sepolia public client unavailable");
      await ensureMantleSepolia();

      const data = encodeFunctionData({
        abi: intentBookAbi,
        functionName: "submitIntent",
        args: [
          draft.asset,
          draft.direction,
          BigInt(Math.trunc(draft.notionalUsd)),
          BigInt(Math.trunc(draft.durationMinutes)),
          BigInt(Math.trunc(draft.maxCostBps)),
          draft.urgency
        ]
      });

      const txHash = await sendTransactionAsync({
        chainId: mantleSepolia.id,
        to: CONTRACTS.intentBook,
        data
      });
      setIntentOutput(JSON.stringify({ txHash, status: "waiting_for_receipt", explorer: txLink(txHash) }, null, 2));

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") {
        throw new Error(`Intent submit reverted: ${txHash}`);
      }
      const submittedLog = parseEventLogs({
        abi: intentBookAbi,
        eventName: "HedgeIntentSubmitted",
        logs: receipt.logs
      })[0];
      const submittedArgs = submittedLog?.args;
      const onchainIntentId = submittedArgs?.intentId ?? null;

      const saved = await api<HedgeIntent>("/api/intents", {
        method: "POST",
        body: {
          ...draft,
          user: address,
          naturalLanguage,
          parserConfidence: parsed?.confidence ?? null,
          onchainIntentId,
          submitTxHash: txHash
        }
      });

      await recordChainEvent({
        eventName: "HedgeIntentSubmitted",
        contractName: "IntentBook",
        contractAddress: CONTRACTS.intentBook,
        txHash,
        blockNumber: blockNumberToNumber(receipt.blockNumber),
        intentId: saved.intentId,
        onchainId: onchainIntentId,
        payload: stringifyBigInts(submittedArgs ?? {})
      });

      setIntentOutput(
        JSON.stringify(
          {
            txHash,
            blockNumber: blockNumberToNumber(receipt.blockNumber),
            onchainIntentId,
            explorer: txLink(txHash),
            dbIntent: saved
          },
          null,
          2
        )
      );
      await refreshBook();
      await refreshEvents();
    });
  }

  async function refreshBook() {
    const result = await api<IntentBook>(`/api/intents?asset=${draft.asset}`);
    setBook(result);
  }

  async function runMatching() {
    await runBusy("match", async () => {
      const result = await api<MatchResponse>("/api/matching/run", {
        method: "POST",
        body: {
          asset: draft.asset,
          maxCostBps: draft.maxCostBps,
          urgency: draft.urgency
        }
      });
      setLatestMatch(result);
      await refreshBook();
    });
  }

  async function logDecision() {
    await runBusy("log", async () => {
      if (!address) throw new Error("Connect wallet first");
      if (!latestMatch) throw new Error("Run matching first");
      if (!publicClient) throw new Error("Mantle Sepolia public client unavailable");
      await ensureMantleSepolia();

      const savingsBps = BigInt(Math.max(0, Math.round(latestMatch.costComparison.savedCostBps)));
      const matchId = await bytes32FromText(latestMatch.matchResult.matchId);
      const decisionId = await bytes32FromText(latestMatch.decision.decisionId);

      const matchData = encodeFunctionData({
        abi: matchLogAbi,
        functionName: "logMatch",
        args: [
          matchId,
          latestMatch.matchResult.asset,
          BigInt(Math.trunc(latestMatch.matchResult.matchedNotionalUsd)),
          BigInt(Math.trunc(latestMatch.matchResult.residualNotionalUsd)),
          savingsBps
        ]
      });
      const matchTxHash = await sendTransactionAsync({
        chainId: mantleSepolia.id,
        to: CONTRACTS.matchLog,
        data: matchData
      });
      setChainOutput(JSON.stringify({ matchTxHash, status: "waiting_for_match_receipt", explorer: txLink(matchTxHash) }, null, 2));

      const matchReceipt = await publicClient.waitForTransactionReceipt({ hash: matchTxHash });
      if (matchReceipt.status !== "success") {
        throw new Error(`Match log reverted: ${matchTxHash}`);
      }
      const matchedLog = parseEventLogs({
        abi: matchLogAbi,
        eventName: "HedgeMatched",
        logs: matchReceipt.logs
      })[0];
      const matchedArgs = matchedLog?.args;

      await recordChainEvent({
        eventName: "HedgeMatched",
        txHash: matchTxHash,
        blockNumber: blockNumberToNumber(matchReceipt.blockNumber),
        matchId: latestMatch.matchResult.matchId,
        onchainId: matchedArgs?.matchId ?? matchId,
        payload: stringifyBigInts(matchedArgs ?? {
          asset: latestMatch.matchResult.asset,
          matchedNotionalUsd: latestMatch.matchResult.matchedNotionalUsd,
          residualNotionalUsd: latestMatch.matchResult.residualNotionalUsd,
          estimatedSavingsBps: savingsBps
        })
      });

      const decisionData = encodeFunctionData({
        abi: matchLogAbi,
        functionName: "logAgentDecision",
        args: [
          decisionId,
          latestMatch.decision.decisionType,
          BigInt(Math.trunc(latestMatch.decision.internalMatchUsd)),
          BigInt(Math.trunc(latestMatch.decision.residualUsd)),
          savingsBps
        ]
      });
      const decisionTxHash = await sendTransactionAsync({
        chainId: mantleSepolia.id,
        to: CONTRACTS.matchLog,
        data: decisionData
      });
      setChainOutput(
        JSON.stringify(
          {
            matchTxHash,
            matchBlockNumber: blockNumberToNumber(matchReceipt.blockNumber),
            decisionTxHash,
            status: "waiting_for_decision_receipt",
            decisionExplorer: txLink(decisionTxHash)
          },
          null,
          2
        )
      );

      const decisionReceipt = await publicClient.waitForTransactionReceipt({ hash: decisionTxHash });
      if (decisionReceipt.status !== "success") {
        throw new Error(`Decision log reverted: ${decisionTxHash}`);
      }
      const decisionLog = parseEventLogs({
        abi: matchLogAbi,
        eventName: "AgentDecisionLogged",
        logs: decisionReceipt.logs
      })[0];
      const decisionArgs = decisionLog?.args;

      await recordChainEvent({
        eventName: "AgentDecisionLogged",
        txHash: decisionTxHash,
        blockNumber: blockNumberToNumber(decisionReceipt.blockNumber),
        decisionId: latestMatch.decision.decisionId,
        onchainId: decisionArgs?.decisionId ?? decisionId,
        payload: stringifyBigInts(decisionArgs ?? {
          decisionType: latestMatch.decision.decisionType,
          internalMatchUsd: latestMatch.decision.internalMatchUsd,
          residualUsd: latestMatch.decision.residualUsd,
          estimatedSavingsBps: savingsBps
        })
      });

      setChainOutput(
        JSON.stringify(
          stringifyBigInts({
            matchTxHash,
            decisionTxHash,
            matchBlockNumber: matchReceipt.blockNumber,
            decisionBlockNumber: decisionReceipt.blockNumber,
            matchExplorer: txLink(matchTxHash),
            decisionExplorer: txLink(decisionTxHash),
            matchedEvent: matchedArgs ?? null,
            decisionEvent: decisionArgs ?? null
          }),
          null,
          2
        )
      );
      await refreshEvents();
    });
  }

  async function recordChainEvent(input: Record<string, unknown>) {
    return api("/api/chain-events", {
      method: "POST",
      body: {
        network: "mantle-sepolia",
        chainId: mantleSepolia.id,
        contractName: "MatchLog",
        contractAddress: CONTRACTS.matchLog,
        ...input
      }
    });
  }

  async function refreshEvents() {
    const result = await api<{ events: ChainEvent[] }>("/api/chain-events?network=mantle-sepolia&limit=8");
    setEvents(result.events);
  }

  async function runBusy(label: string, task: () => Promise<void>) {
    setBusy(label);
    try {
      await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setIntentOutput(JSON.stringify({ error: message }, null, 2));
      setChainOutput(JSON.stringify({ error: message }, null, 2));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1440px] px-5 py-6 text-[#f5f7f8] md:px-8">
      <header className="mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="mb-1 text-xs font-extrabold uppercase text-mint">Mantle Sepolia</p>
          <h1 className="text-[28px] font-bold leading-tight md:text-4xl">ZeroSlip HedgeMesh</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={chainId === mantleSepolia.id ? "ready" : "warn"}>{networkLabel}</StatusPill>
          <StatusPill>{connectedLabel}</StatusPill>
          {isConnected ? (
            <button className="h-10 rounded-md bg-panel-strong px-4 font-bold" onClick={() => disconnect()} type="button">
              Disconnect
            </button>
          ) : (
            <ActionButton busy={busy === "wallet" || isConnecting} icon={<Wallet size={17} />} onClick={connectWallet}>
              Connect
            </ActionButton>
          )}
        </div>
      </header>

      <section className="mb-5 flex flex-wrap gap-2">
        <ContractLink label="IntentBook" address={CONTRACTS.intentBook} />
        <ContractLink label="MatchLog" address={CONTRACTS.matchLog} />
        <span className="rounded-full border border-line bg-[#171b1f] px-3 py-2 text-sm text-[#9ba7b1]">Chain ID 5003</span>
      </section>

      <section className="mb-4 grid gap-3 md:grid-cols-4">
        <Metric label="Internal Match" value={usd(metrics.internalMatch)} />
        <Metric label="Residual Hedge" value={`${usd(metrics.residual)} ${metrics.residualDirection}`} />
        <Metric label="Liquidity Avoided" value={usd(metrics.avoided)} />
        <Metric label="Saved Cost" value={`${metrics.saved} bps`} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.08fr_0.92fr]">
        <Panel className="lg:row-span-2" eyebrow="Step 1" title="Submit Hedge Intent">
          <div className="mb-4 flex justify-end">
            <ActionButton busy={busy === "parse"} icon={<Wand2 size={17} />} onClick={parseIntent} variant="secondary">
              AI Parse
            </ActionButton>
          </div>
          <label className="mb-3 block">
            <span className="mb-2 block text-sm text-[#9ba7b1]">Natural language</span>
            <textarea
              className="min-h-[112px] w-full resize-y rounded-md border border-[#3a4650] bg-[#11161b] p-3 outline-none focus:border-mint"
              value={naturalLanguage}
              onChange={(event) => setNaturalLanguage(event.target.value)}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="Asset" value={draft.asset} onChange={(asset) => updateDraft({ asset: asset as HedgeIntentDraft["asset"] })} options={["MNT", "mETH", "USDC"]} />
            <SelectField label="Direction" value={draft.direction} onChange={(direction) => updateDraft({ direction: direction as Direction })} options={["SHORT", "LONG"]} />
            <NumberField label="Notional USD" value={draft.notionalUsd} onChange={(notionalUsd) => updateDraft({ notionalUsd })} />
            <NumberField label="Duration minutes" value={draft.durationMinutes} onChange={(durationMinutes) => updateDraft({ durationMinutes })} />
            <NumberField label="Max cost bps" value={draft.maxCostBps} onChange={(maxCostBps) => updateDraft({ maxCostBps })} />
            <SelectField label="Urgency" value={draft.urgency} onChange={(urgency) => updateDraft({ urgency: urgency as Urgency })} options={["LOW", "MEDIUM", "HIGH"]} />
          </div>
          <ActionButton busy={busy === "submit"} className="mt-4 w-full" icon={<Send size={17} />} onClick={submitIntent}>
            Submit to Mantle + DB
          </ActionButton>
          <Output value={intentOutput} />
        </Panel>

        <Panel eyebrow="Step 2" title="Intent Book">
          <div className="mb-3 flex justify-end">
            <ActionButton busy={busy === "refresh"} icon={<RefreshCw size={17} />} onClick={refreshBook} variant="secondary">
              Refresh
            </ActionButton>
          </div>
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <Demand label="SHORT demand" value={usd(book.shortDemandUsd)} />
            <Demand label="LONG demand" value={usd(book.longDemandUsd)} />
          </div>
          <div className="grid max-h-[360px] gap-2 overflow-auto">
            {book.intents.length === 0 ? (
              <Row muted>No intents yet.</Row>
            ) : (
              book.intents.map((intent) => (
                <Row key={intent.intentId}>
                  <strong>
                    {intent.direction} {intent.asset} {usd(intent.notionalUsd)}
                  </strong>
                  <span>
                    {shortAddress(intent.user)} | {intent.status} | filled {usd(intent.filledNotionalUsd)}
                  </span>
                  {intent.submitTxHash ? <ExplorerLink hash={intent.submitTxHash} /> : <span>No tx hash</span>}
                </Row>
              ))
            )}
          </div>
        </Panel>

        <Panel eyebrow="Step 3" title="Matching Result">
          <div className="mb-3 flex justify-end">
            <ActionButton busy={busy === "match"} icon={<GitBranch size={17} />} onClick={runMatching}>
              Run Matching
            </ActionButton>
          </div>
          <Output tall value={latestMatch ? JSON.stringify(latestMatch, null, 2) : "No match yet."} />
        </Panel>

        <Panel eyebrow="Step 4" title="On-chain Log">
          <div className="mb-3 flex justify-end">
            <ActionButton busy={busy === "log"} icon={<ShieldCheck size={17} />} onClick={logDecision} variant="secondary">
              Log Decision
            </ActionButton>
          </div>
          <div className="mb-3 grid max-h-[260px] gap-2 overflow-auto">
            {events.length === 0 ? (
              <Row muted>No logged chain events yet.</Row>
            ) : (
              events.map((event) => (
                <Row key={event.eventId}>
                  <strong>{event.eventName}</strong>
                  <span>
                    {event.contractName} | {new Date(event.createdAt).toLocaleString()}
                  </span>
                  <ExplorerLink hash={event.txHash} />
                </Row>
              ))
            )}
          </div>
          <Output value={chainOutput} />
        </Panel>
      </section>
    </main>
  );

  function updateDraft(patch: Partial<HedgeIntentDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }
}

function Panel({
  children,
  className = "",
  eyebrow,
  title
}: {
  children: React.ReactNode;
  className?: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <section className={`rounded-lg border border-line bg-panel/95 p-4 shadow-2xl ${className}`}>
      <div className="mb-1">
        <p className="mb-1 text-xs font-extrabold uppercase text-mint">{eyebrow}</p>
        <h2 className="text-xl font-bold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function ActionButton({
  busy,
  children,
  className = "",
  icon,
  onClick,
  variant = "primary"
}: {
  busy?: boolean;
  children: React.ReactNode;
  className?: string;
  icon: React.ReactNode;
  onClick: () => void | Promise<void>;
  variant?: "primary" | "secondary";
}) {
  const colors =
    variant === "primary" ? "bg-mint text-[#09211d]" : "bg-panel-strong text-[#f5f7f8]";
  return (
    <button
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 font-extrabold disabled:cursor-wait disabled:opacity-60 ${colors} ${className}`}
      disabled={busy}
      onClick={onClick}
      type="button"
    >
      {busy ? <Activity className="animate-spin" size={17} /> : icon}
      <span>{children}</span>
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="min-h-[112px] rounded-lg border border-line bg-panel/95 p-4 shadow-2xl">
      <span className="mb-2 block text-sm text-[#9ba7b1]">{label}</span>
      <strong className="block break-words text-2xl leading-tight md:text-[28px]">{value}</strong>
    </article>
  );
}

function Demand({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#34404a] bg-panel-strong p-3">
      <span className="mb-2 block text-sm text-[#9ba7b1]">{label}</span>
      <strong className="text-xl">{value}</strong>
    </div>
  );
}

function Row({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <article className="grid gap-1 rounded-lg border border-[#2d3740] bg-[#151a1f] p-3 text-sm">
      <span className={muted ? "text-[#9ba7b1]" : "contents"}>{children}</span>
    </article>
  );
}

function NumberField({
  label,
  onChange,
  value
}: {
  label: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label>
      <span className="mb-2 block text-sm text-[#9ba7b1]">{label}</span>
      <input
        className="h-10 w-full rounded-md border border-[#3a4650] bg-[#11161b] px-3 outline-none focus:border-mint"
        min={0}
        onChange={(event) => onChange(Number(event.target.value))}
        type="number"
        value={value}
      />
    </label>
  );
}

function SelectField({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label>
      <span className="mb-2 block text-sm text-[#9ba7b1]">{label}</span>
      <select
        className="h-10 w-full rounded-md border border-[#3a4650] bg-[#11161b] px-3 outline-none focus:border-mint"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function StatusPill({ children, tone }: { children: React.ReactNode; tone?: "ready" | "warn" }) {
  const color = tone === "ready" ? "text-[#6fd08c]" : tone === "warn" ? "text-amber" : "text-[#9ba7b1]";
  return (
    <span className={`inline-flex min-h-[34px] items-center rounded-full border border-line bg-[#171b1f] px-3 text-sm ${color}`}>
      {children}
    </span>
  );
}

function ContractLink({ address, label }: { address: string; label: string }) {
  return (
    <a
      className="inline-flex min-h-[34px] items-center rounded-full border border-line bg-[#171b1f] px-3 text-sm text-mint"
      href={`${EXPLORER}/address/${address}`}
      rel="noreferrer"
      target="_blank"
    >
      {label}
    </a>
  );
}

function ExplorerLink({ hash }: { hash: string }) {
  return (
    <a className="break-all text-mint" href={txLink(hash)} rel="noreferrer" target="_blank">
      {shortAddress(hash)}
    </a>
  );
}

function Output({ tall, value }: { tall?: boolean; value: string }) {
  return (
    <pre className={`mt-3 overflow-auto rounded-lg border border-[#2e3841] bg-[#0e1216] p-3 text-sm leading-relaxed text-[#c8d2da] ${tall ? "min-h-[300px]" : "min-h-[76px]"}`}>
      {value}
    </pre>
  );
}

function blockNumberToNumber(value: bigint | number | null | undefined) {
  if (value === null || value === undefined) return null;
  return typeof value === "bigint" ? Number(value) : value;
}

function stringifyBigInts(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => stringifyBigInts(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, stringifyBigInts(item)])
    );
  }
  return value;
}

async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.errors?.join(", ") ?? `HTTP ${response.status}`);
  }
  return payload;
}

async function bytes32FromText(text: string): Promise<`0x${string}`> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function usd(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency"
  }).format(Number(value ?? 0));
}

function shortAddress(value: string) {
  if (!value) return "No wallet";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function txLink(txHash: string) {
  return `${EXPLORER}/tx/${txHash}`;
}
