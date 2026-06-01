const MANTLE_SEPOLIA = {
  chainId: "0x138b",
  chainName: "Mantle Sepolia Testnet",
  nativeCurrency: { name: "MNT", symbol: "MNT", decimals: 18 },
  rpcUrls: ["https://rpc.sepolia.mantle.xyz"],
  blockExplorerUrls: ["https://explorer.sepolia.mantle.xyz"]
};

const NETWORK = {
  name: "mantle-sepolia",
  chainId: 5003,
  explorer: "https://explorer.sepolia.mantle.xyz"
};

const CONTRACTS = {
  intentBook: "0x7489039281b77aab0ef24f56e333f28cfc352ee9",
  matchLog: "0xc02797d86f47ac6757383039b4bb5c2d9fe4e3cc"
};

const SELECTORS = {
  submitIntent: "0x4bd75d99",
  logMatch: "0x86f1b03b",
  logAgentDecision: "0x8476c2da"
};

const state = {
  account: null,
  parsed: null,
  latestMatch: null,
  latestTxs: []
};

const els = {
  networkStatus: document.querySelector("#networkStatus"),
  walletAddress: document.querySelector("#walletAddress"),
  connectWallet: document.querySelector("#connectWallet"),
  intentBookLink: document.querySelector("#intentBookLink"),
  matchLogLink: document.querySelector("#matchLogLink"),
  parseIntent: document.querySelector("#parseIntent"),
  submitIntent: document.querySelector("#submitIntent"),
  refreshBook: document.querySelector("#refreshBook"),
  runMatching: document.querySelector("#runMatching"),
  logDecision: document.querySelector("#logDecision"),
  naturalLanguage: document.querySelector("#naturalLanguage"),
  asset: document.querySelector("#asset"),
  direction: document.querySelector("#direction"),
  notionalUsd: document.querySelector("#notionalUsd"),
  durationMinutes: document.querySelector("#durationMinutes"),
  maxCostBps: document.querySelector("#maxCostBps"),
  urgency: document.querySelector("#urgency"),
  shortDemand: document.querySelector("#shortDemand"),
  longDemand: document.querySelector("#longDemand"),
  intentList: document.querySelector("#intentList"),
  intentOutput: document.querySelector("#intentOutput"),
  matchingOutput: document.querySelector("#matchingOutput"),
  chainEvents: document.querySelector("#chainEvents"),
  chainOutput: document.querySelector("#chainOutput"),
  metricInternalMatch: document.querySelector("#metricInternalMatch"),
  metricResidual: document.querySelector("#metricResidual"),
  metricMatchRate: document.querySelector("#metricMatchRate"),
  metricAvoided: document.querySelector("#metricAvoided"),
  metricSaved: document.querySelector("#metricSaved")
};

boot();

function boot() {
  els.intentBookLink.href = `${NETWORK.explorer}/address/${CONTRACTS.intentBook}`;
  els.matchLogLink.href = `${NETWORK.explorer}/address/${CONTRACTS.matchLog}`;

  els.connectWallet.addEventListener("click", connectWallet);
  els.parseIntent.addEventListener("click", parseIntent);
  els.submitIntent.addEventListener("click", submitIntent);
  els.refreshBook.addEventListener("click", refreshBook);
  els.runMatching.addEventListener("click", runMatching);
  els.logDecision.addEventListener("click", logDecision);

  if (window.ethereum) {
    window.ethereum.request({ method: "eth_accounts" }).then((accounts) => {
      if (accounts[0]) setAccount(accounts[0]);
    });
    window.ethereum.on?.("accountsChanged", (accounts) => setAccount(accounts[0] ?? null));
    window.ethereum.on?.("chainChanged", refreshNetworkStatus);
  }

  refreshBook();
  refreshChainEvents();
  refreshNetworkStatus();
}

async function connectWallet() {
  await withButton(els.connectWallet, "Connecting", async () => {
    assertWallet();
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    setAccount(accounts[0]);
    await switchToMantleSepolia();
    await refreshNetworkStatus();
  });
}

async function parseIntent() {
  await withButton(els.parseIntent, "Parsing", async () => {
    const parsed = await api("/api/intent/parse", {
      method: "POST",
      body: { text: els.naturalLanguage.value }
    });

    state.parsed = parsed;
    els.asset.value = parsed.asset ?? "MNT";
    els.direction.value = parsed.direction ?? "SHORT";
    els.notionalUsd.value = parsed.notionalUsd ?? 10000;
    els.durationMinutes.value = parsed.durationMinutes ?? 60;
    els.maxCostBps.value = parsed.maxCostBps ?? 30;
    els.urgency.value = parsed.urgency ?? "MEDIUM";
    writeOutput(els.intentOutput, parsed);
  });
}

async function submitIntent() {
  await withButton(els.submitIntent, "Submitting", async () => {
    assertWallet();
    await switchToMantleSepolia();

    const intent = readIntentForm();
    const data = encodeCall(
      SELECTORS.submitIntent,
      ["string", "string", "uint256", "uint256", "uint256", "string"],
      [
        intent.asset,
        intent.direction,
        intent.notionalUsd,
        intent.durationMinutes,
        intent.maxCostBps,
        intent.urgency
      ]
    );

    const txHash = await sendTx(CONTRACTS.intentBook, data);
    const saved = await api("/api/intents", {
      method: "POST",
      body: {
        ...intent,
        user: state.account,
        naturalLanguage: els.naturalLanguage.value,
        parserConfidence: state.parsed?.confidence ?? null,
        submitTxHash: txHash
      }
    });

    writeOutput(els.intentOutput, {
      txHash,
      explorer: txLink(txHash),
      dbIntent: saved
    });
    state.latestTxs.unshift(txHash);
    await refreshBook();
  });
}

async function refreshBook() {
  const book = await api(`/api/intents?asset=${encodeURIComponent(els.asset.value || "MNT")}`);
  els.shortDemand.textContent = usd(book.shortDemandUsd);
  els.longDemand.textContent = usd(book.longDemandUsd);

  if (book.intents.length === 0) {
    els.intentList.innerHTML = `<div class="intent-row"><span>No intents yet.</span></div>`;
    return;
  }

  els.intentList.innerHTML = book.intents
    .map(
      (intent) => `
        <article class="intent-row">
          <strong>${escapeHtml(intent.direction)} ${escapeHtml(intent.asset)} ${usd(intent.notionalUsd)}</strong>
          <span>${escapeHtml(shortAddress(intent.user))} | ${escapeHtml(intent.status)} | filled ${usd(intent.filledNotionalUsd)}</span>
          <span>${intent.submitTxHash ? link(txLink(intent.submitTxHash), intent.submitTxHash) : "No tx hash"}</span>
        </article>
      `
    )
    .join("");
}

async function runMatching() {
  await withButton(els.runMatching, "Matching", async () => {
    const result = await api("/api/matching/run", {
      method: "POST",
      body: {
        asset: els.asset.value,
        maxCostBps: Number(els.maxCostBps.value),
        urgency: els.urgency.value
      }
    });

    state.latestMatch = result;
    renderMetrics(result);
    writeOutput(els.matchingOutput, result);
    await refreshBook();
  });
}

async function logDecision() {
  await withButton(els.logDecision, "Logging", async () => {
    assertWallet();
    await switchToMantleSepolia();

    if (!state.latestMatch) {
      throw new Error("run matching before logging a decision");
    }

    const { matchResult, costComparison, decision } = state.latestMatch;
    const savingsBps = Math.max(0, Math.round(costComparison.savedCostBps));
    const matchBytes32 = await bytes32FromText(matchResult.matchId);
    const decisionBytes32 = await bytes32FromText(decision.decisionId);

    const matchData = encodeCall(
      SELECTORS.logMatch,
      ["bytes32", "string", "uint256", "uint256", "uint256"],
      [
        matchBytes32,
        matchResult.asset,
        matchResult.matchedNotionalUsd,
        matchResult.residualNotionalUsd,
        savingsBps
      ]
    );
    const matchTxHash = await sendTx(CONTRACTS.matchLog, matchData);
    await recordChainEvent({
      eventName: "HedgeMatched",
      contractName: "MatchLog",
      contractAddress: CONTRACTS.matchLog,
      txHash: matchTxHash,
      matchId: matchResult.matchId,
      onchainId: matchBytes32,
      payload: {
        asset: matchResult.asset,
        matchedNotionalUsd: matchResult.matchedNotionalUsd,
        residualNotionalUsd: matchResult.residualNotionalUsd,
        estimatedSavingsBps: savingsBps
      }
    });

    const decisionData = encodeCall(
      SELECTORS.logAgentDecision,
      ["bytes32", "string", "uint256", "uint256", "uint256"],
      [
        decisionBytes32,
        decision.decisionType,
        decision.internalMatchUsd,
        decision.residualUsd,
        savingsBps
      ]
    );
    const decisionTxHash = await sendTx(CONTRACTS.matchLog, decisionData);
    await recordChainEvent({
      eventName: "AgentDecisionLogged",
      contractName: "MatchLog",
      contractAddress: CONTRACTS.matchLog,
      txHash: decisionTxHash,
      decisionId: decision.decisionId,
      onchainId: decisionBytes32,
      payload: {
        decisionType: decision.decisionType,
        internalMatchUsd: decision.internalMatchUsd,
        residualUsd: decision.residualUsd,
        estimatedSavingsBps: savingsBps
      }
    });

    state.latestTxs.unshift(decisionTxHash, matchTxHash);
    writeOutput(els.chainOutput, {
      matchTxHash,
      decisionTxHash,
      matchExplorer: txLink(matchTxHash),
      decisionExplorer: txLink(decisionTxHash)
    });
    await refreshChainEvents();
  });
}

async function refreshChainEvents() {
  const result = await api("/api/chain-events?network=mantle-sepolia&limit=8");
  if (!result.events.length) {
    els.chainEvents.innerHTML = `<div class="event-row"><span>No logged chain events yet.</span></div>`;
    return;
  }

  els.chainEvents.innerHTML = result.events
    .map(
      (event) => `
        <article class="event-row">
          <strong>${escapeHtml(event.eventName)}</strong>
          <span>${escapeHtml(event.contractName)} | ${escapeHtml(new Date(event.createdAt).toLocaleString())}</span>
          <span>${link(txLink(event.txHash), event.txHash)}</span>
        </article>
      `
    )
    .join("");
}

async function recordChainEvent(event) {
  return api("/api/chain-events", {
    method: "POST",
    body: {
      network: NETWORK.name,
      chainId: NETWORK.chainId,
      ...event
    }
  });
}

function renderMetrics(result) {
  const { matchResult, costComparison } = result;
  els.metricInternalMatch.textContent = usd(matchResult.matchedNotionalUsd);
  els.metricResidual.textContent = `${usd(matchResult.residualNotionalUsd)} ${matchResult.residualDirection}`;
  els.metricMatchRate.textContent = `${Math.round(matchResult.internalMatchRate * 100)}%`;
  els.metricAvoided.textContent = usd(costComparison.externalLiquidityAvoidedUsd);
  els.metricSaved.textContent = `${costComparison.savedCostBps} bps`;
}

function readIntentForm() {
  return {
    asset: els.asset.value,
    direction: els.direction.value,
    notionalUsd: Number(els.notionalUsd.value),
    durationMinutes: Number(els.durationMinutes.value),
    maxCostBps: Number(els.maxCostBps.value),
    urgency: els.urgency.value
  };
}

async function switchToMantleSepolia() {
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: MANTLE_SEPOLIA.chainId }]
    });
  } catch (error) {
    if (error.code !== 4902) throw error;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [MANTLE_SEPOLIA]
    });
  }
}

async function refreshNetworkStatus() {
  if (!window.ethereum) {
    els.networkStatus.textContent = "MetaMask required";
    els.networkStatus.className = "status-pill warn";
    return;
  }

  const chainId = await window.ethereum.request({ method: "eth_chainId" }).catch(() => null);
  if (chainId === MANTLE_SEPOLIA.chainId) {
    els.networkStatus.textContent = "Mantle Sepolia";
    els.networkStatus.className = "status-pill ready";
    return;
  }

  els.networkStatus.textContent = "Wrong network";
  els.networkStatus.className = "status-pill warn";
}

function setAccount(account) {
  state.account = account;
  els.walletAddress.textContent = account ? shortAddress(account) : "No wallet";
  els.connectWallet.textContent = account ? "Connected" : "Connect";
}

function assertWallet() {
  if (!window.ethereum) throw new Error("MetaMask is required");
  if (!state.account) throw new Error("connect wallet first");
}

async function sendTx(to, data) {
  return window.ethereum.request({
    method: "eth_sendTransaction",
    params: [{ from: state.account, to, data }]
  });
}

async function api(path, options = {}) {
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

async function withButton(button, label, task) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    await task();
  } catch (error) {
    writeOutput(els.chainOutput, { error: error.message });
    writeOutput(els.intentOutput, { error: error.message });
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function encodeCall(selector, types, values) {
  const head = [];
  const tail = [];
  let offset = BigInt(types.length * 32);

  types.forEach((type, index) => {
    const value = values[index];
    if (type === "string") {
      const encoded = encodeString(value);
      head.push(word(offset));
      tail.push(strip0x(encoded));
      offset += BigInt(strip0x(encoded).length / 2);
      return;
    }
    if (type === "uint256") {
      head.push(word(BigInt(Math.trunc(Number(value)))));
      return;
    }
    if (type === "bytes32") {
      head.push(strip0x(assertBytes32(value)));
      return;
    }
    throw new Error(`unsupported ABI type ${type}`);
  });

  return selector + head.join("") + tail.join("");
}

function encodeString(value) {
  const bytes = new TextEncoder().encode(String(value));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const paddedLength = Math.ceil(bytes.length / 32) * 64;
  return `0x${word(BigInt(bytes.length))}${hex.padEnd(paddedLength, "0")}`;
}

function word(value) {
  if (value < 0n) throw new Error("uint256 cannot be negative");
  return value.toString(16).padStart(64, "0");
}

function assertBytes32(value) {
  const hex = strip0x(value);
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("invalid bytes32");
  return `0x${hex}`;
}

async function bytes32FromText(text) {
  const seed = new TextEncoder().encode(`${text}:${Date.now()}:${Math.random()}`);
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", seed);
    return `0x${Array.from(new Uint8Array(digest), toHex).join("")}`;
  }

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, toHex).join("")}`;
}

function strip0x(value) {
  return String(value).startsWith("0x") ? String(value).slice(2) : String(value);
}

function toHex(byte) {
  return byte.toString(16).padStart(2, "0");
}

function writeOutput(element, value) {
  element.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function usd(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value ?? 0));
}

function shortAddress(value) {
  if (!value) return "No wallet";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function txLink(txHash) {
  return `${NETWORK.explorer}/tx/${txHash}`;
}

function link(url, label) {
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(shortAddress(label))}</a>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
