const HOST_ID = "tapover-host";
const MODAL_ID = "tapover-modal";

const FOMO_CHAIN = {
  robinhood: "robinhood",
  sol: "solana",
  base: "base",
  bsc: "bnb",
  eth: "ethereum",
  monad: "monad",
};

const TOKEN_RE =
  /^\/(robinhood|sol|bsc|base|eth|arc|stable|monad|tron)\/token\/([^/?#]+)/i;

const DEFAULT_BUY = [5, 20, 50, 100];
const DEFAULT_SELL = [25, 50, 75, 100];

let buyPresets = [...DEFAULT_BUY];
let sellPresets = [...DEFAULT_SELL];
let lastStatusKey = "";
let lastPrefetchKey = "";
let routeTimer = 0;
let observer = null;
let injectGen = 0;
let lastHref = "";
let lastUsd = 20;
let lastPercent = 100;
let lastPosition = { hasPosition: false, usd: 0, tokenAmount: 0, symbol: "", cashUsd: 0 };
let positionKey = "";
let positionBusy = false;

const presetsReady = chrome.storage.local
  .get([
    "tapoverUsd",
    "tapoverPercent",
    "tapoverBuyPresets",
    "tapoverSellPresets",
    "fomoUsd",
    "fomoPercent",
    "fomoBuyPresets",
    "fomoSellPresets",
  ])
  .then((s) => {
    if (Number(s.tapoverUsd) > 0) lastUsd = Number(s.tapoverUsd);
    else if (Number(s.fomoUsd) > 0) lastUsd = Number(s.fomoUsd);
    if (Number(s.tapoverPercent) > 0) lastPercent = Number(s.tapoverPercent);
    else if (Number(s.fomoPercent) > 0) lastPercent = Number(s.fomoPercent);
    buyPresets = normalizeBuy(s.tapoverBuyPresets || s.fomoBuyPresets);
    sellPresets = normalizeSell(s.tapoverSellPresets || s.fomoSellPresets);
  });

function normalizeBuy(raw) {
  const src = Array.isArray(raw) ? raw : DEFAULT_BUY;
  const out = [];
  for (let i = 0; i < 4; i++) {
    const n = Number(src[i]);
    out.push(Number.isFinite(n) && n > 0 ? Math.min(20000, n) : DEFAULT_BUY[i]);
  }
  return out;
}

function normalizeSell(raw) {
  const src = Array.isArray(raw) ? raw : DEFAULT_SELL;
  const out = [];
  for (let i = 0; i < 4; i++) {
    const n = Number(src[i]);
    out.push(Number.isFinite(n) && n > 0 ? Math.min(100, n) : DEFAULT_SELL[i]);
  }
  return out;
}

function formatPreset(n) {
  if (!Number.isFinite(n)) return "";
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r);
}

function formatUsdQty(n) {
  if (!Number.isFinite(n) || n < 0) return "0.00";
  return (Math.round(n * 100) / 100).toFixed(2);
}

function sellSliceUsd() {
  return Math.max(0, (Number(lastPosition.usd) || 0) * lastPercent / 100);
}

function parseToken(href = location.href) {
  let u;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const m = u.pathname.match(TOKEN_RE);
  if (!m) return null;
  const gmgnChain = m[1].toLowerCase();
  const address = decodeURIComponent(m[2]);
  const fomoChain = FOMO_CHAIN[gmgnChain];
  if (!fomoChain) return null;
  let addr = address;
  if (/^0x[a-fA-F0-9]{40}$/.test(addr)) addr = addr.toLowerCase();
  const fomoUrl = `https://fomo.family/tokens/${fomoChain}/${addr}`;
  return { gmgnChain, fomoChain, address: addr, fomoUrl };
}

function shortAddr(address) {
  if (!address || address.length <= 12) return address || "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function readSymbol() {
  const title = document.title || "";
  const head = title.split("|")[0]?.trim() || "";
  const cleaned = head.replace(/[↑↓].*$/, "").trim();
  const token = cleaned.split(/\s+/)[0];
  if (token && token !== "GMGN.AI" && token.length <= 24) return token;
  return "";
}

function findTradeCard() {
  const rail = document.querySelector('[data-sentry-component="TokenRight"]');
  if (!rail) return null;
  const types = rail.querySelector('[data-sentry-component="Types"]');
  if (!types) return null;
  let el = types.parentElement;
  while (el && el !== rail) {
    const hasGases = el.querySelector('[data-sentry-component="CustomGases"]');
    const hasBtn = el.querySelector('[data-sentry-component="TradeButtonText"]');
    if (hasGases && hasBtn) return el;
    el = el.parentElement;
  }
  let fallback = types.parentElement;
  while (fallback && fallback !== rail) {
    if (fallback.querySelector('[data-sentry-component="TradeButtonText"]')) {
      return fallback;
    }
    fallback = fallback.parentElement;
  }
  return null;
}

function panelStyles() {
  return `
    :host { display: block; margin-top: 10px; font-family: inherit; }
    .wrap {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px;
      border: 1px solid #2a2d36;
      border-radius: 6px;
      background: #14161c;
      color: #c5c8d0;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }
    .brand {
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #7a7f8c;
    }
    .gear {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      padding: 0;
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: #7a7f8c;
      cursor: pointer;
    }
    .gear:hover { color: #eceef3; background: #1c1f28; }
    .gear svg { display: block; }
    .sides {
      display: flex;
      height: 28px;
      border: 1px solid #2a2d36;
      border-radius: 6px;
      overflow: hidden;
    }
    .sides button {
      flex: 1;
      border: 0;
      background: transparent;
      color: #8b909c;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .sides button.on-buy { color: #12b981; background: rgba(18, 185, 129, 0.08); }
    .sides button.on-sell { color: #fb7185; background: rgba(225, 29, 72, 0.08); }
    .sides button:disabled {
      opacity: 0.35;
      cursor: not-allowed;
      color: #8b909c;
      background: transparent;
    }
    .amount-box {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 36px;
      padding: 0 8px;
      border: 1px solid #2a2d36;
      border-radius: 6px;
      background: #101218;
    }
    .amount-box label { font-size: 12px; color: #8b909c; flex-shrink: 0; }
    .amount-box input {
      flex: 1;
      min-width: 0;
      border: 0;
      background: transparent;
      color: #eceef3;
      font-size: 14px;
      font-weight: 600;
      outline: none;
    }
    .amount-box span { font-size: 12px; color: #8b909c; }
    .presets { display: flex; gap: 4px; }
    .presets button {
      flex: 1;
      height: 26px;
      border: 0;
      border-radius: 4px;
      background: #1c1f28;
      color: #c5c8d0;
      font-size: 12px;
      cursor: pointer;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .presets button:hover { background: #262a35; }
    .avail {
      font-size: 12px;
      line-height: 16px;
      color: #8b909c;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .go {
      width: 100%;
      height: 36px;
      border: 0;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .go.buy { background: #12b981; color: #06140f; }
    .go.buy:hover { background: #0ea271; }
    .go.sell { background: #e11d48; color: #fff5f6; }
    .go.sell:hover { background: #be123c; }
    .go[disabled] { opacity: 0.45; cursor: not-allowed; }
    .status {
      font-size: 11px;
      line-height: 14px;
      color: #8b909c;
    }
    .status:empty { display: none; }
    .status.ok { color: #7d8a7a; }
    .status.warn { color: #c4a574; }
    .status.err { color: #d47878; }
  `;
}

function setStatus(root, text, tone) {
  const el = root.querySelector(".status");
  if (!el) return;
  el.textContent = text || "";
  el.className = `status${text && tone ? ` ${tone}` : ""}`;
}

function currentSide(root) {
  return root.querySelector("[data-side].on-buy, [data-side].on-sell")?.dataset.side || "buy";
}

function modalStyles() {
  return `
    :host {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    }
    :host([hidden]) { display: none !important; }
    .backdrop {
      position: absolute;
      inset: 0;
      background: rgba(6, 8, 12, 0.72);
    }
    .dialog {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: min(380px, calc(100vw - 32px));
      padding: 16px;
      border: 1px solid #2a2d36;
      border-radius: 10px;
      background: #14161c;
      color: #c5c8d0;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .title {
      font-size: 15px;
      font-weight: 650;
      color: #eceef3;
    }
    .x {
      width: 28px;
      height: 28px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: #8b909c;
      font-size: 18px;
      line-height: 26px;
      cursor: pointer;
    }
    .x:hover { color: #eceef3; background: #1c1f28; }
    .hint {
      font-size: 12px;
      line-height: 16px;
      color: #8b909c;
      text-align: center;
    }
    .sec { display: flex; flex-direction: column; gap: 8px; }
    .label {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      font-size: 11px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #7a7f8c;
    }
    .label em {
      font-style: normal;
      text-transform: none;
      letter-spacing: 0;
      color: #8b909c;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }
    .cell {
      display: flex;
      align-items: center;
      height: 36px;
      padding: 0 8px;
      border: 1px solid #2a2d36;
      border-radius: 6px;
      background: #101218;
      gap: 4px;
    }
    .cell input {
      flex: 1;
      min-width: 0;
      width: 0;
      border: 0;
      background: transparent;
      color: #eceef3;
      font-size: 13px;
      font-weight: 600;
      outline: none;
    }
    .cell span {
      font-size: 11px;
      color: #8b909c;
      flex-shrink: 0;
    }
    .err {
      min-height: 16px;
      font-size: 12px;
      color: #d47878;
    }
    .actions { display: flex; gap: 8px; }
    .actions button {
      flex: 1;
      height: 36px;
      border: 0;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .cancel { background: #1c1f28; color: #c5c8d0; }
    .cancel:hover { background: #262a35; }
    .save { background: #12b981; color: #06140f; }
    .save:hover { background: #0ea271; }
  `;
}

function ensureModal() {
  let host = document.getElementById(MODAL_ID);
  if (host?.shadowRoot) return host;
  host?.remove();
  host = document.createElement("div");
  host.id = MODAL_ID;
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>${modalStyles()}</style>
    <div class="backdrop" data-close></div>
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="tapover-preset-title">
      <div class="head">
        <span class="title" id="tapover-preset-title">快捷交易预设</span>
        <button class="x" type="button" data-close aria-label="关闭">×</button>
      </div>
      <div class="hint">设置自定义买入和卖出金额，快速填写交易表单。</div>
      <div class="sec">
        <div class="label">买入预设 <em>USD</em></div>
        <div class="grid">
          <label class="cell"><input data-buy inputmode="decimal" /><span>$</span></label>
          <label class="cell"><input data-buy inputmode="decimal" /><span>$</span></label>
          <label class="cell"><input data-buy inputmode="decimal" /><span>$</span></label>
          <label class="cell"><input data-buy inputmode="decimal" /><span>$</span></label>
        </div>
      </div>
      <div class="sec">
        <div class="label">卖出预设 <em>%</em></div>
        <div class="grid">
          <label class="cell"><input data-sell inputmode="decimal" /><span>%</span></label>
          <label class="cell"><input data-sell inputmode="decimal" /><span>%</span></label>
          <label class="cell"><input data-sell inputmode="decimal" /><span>%</span></label>
          <label class="cell"><input data-sell inputmode="decimal" /><span>%</span></label>
        </div>
      </div>
      <div class="err"></div>
      <div class="actions">
        <button class="cancel" type="button" data-close>取消</button>
        <button class="save" type="button">保存</button>
      </div>
    </div>
  `;
  shadow.querySelectorAll("[data-close]").forEach((el) => {
    el.addEventListener("click", closePresetModal);
  });
  shadow.querySelector(".save").addEventListener("click", savePresetModal);
  shadow.querySelector(".dialog").addEventListener("click", (e) => e.stopPropagation());
  host.hidden = true;
  document.body.appendChild(host);
  return host;
}

function onEscModal(e) {
  if (e.key === "Escape") closePresetModal();
}

function openPresetModal() {
  const host = ensureModal();
  const root = host.shadowRoot;
  root.querySelectorAll("[data-buy]").forEach((el, i) => {
    el.value = formatPreset(buyPresets[i]);
  });
  root.querySelectorAll("[data-sell]").forEach((el, i) => {
    el.value = formatPreset(sellPresets[i]);
  });
  const err = root.querySelector(".err");
  if (err) err.textContent = "";
  host.hidden = false;
  document.addEventListener("keydown", onEscModal);
  root.querySelector("[data-buy]")?.focus();
}

function closePresetModal() {
  const host = document.getElementById(MODAL_ID);
  if (host) host.hidden = true;
  document.removeEventListener("keydown", onEscModal);
}

function destroyPresetModal() {
  document.removeEventListener("keydown", onEscModal);
  document.getElementById(MODAL_ID)?.remove();
}

function savePresetModal() {
  const host = document.getElementById(MODAL_ID);
  const root = host?.shadowRoot;
  if (!root) return;
  const parsed = readSheetPresets(root);
  const err = root.querySelector(".err");
  if (parsed.error) {
    err.textContent = parsed.error;
    return;
  }
  buyPresets = parsed.buy;
  sellPresets = parsed.sell;
  chrome.storage.local.set({
    tapoverBuyPresets: buyPresets,
    tapoverSellPresets: sellPresets,
  });
  closePresetModal();
  const panel = document.getElementById(HOST_ID)?.shadowRoot;
  if (panel) {
    syncSideUi(panel);
    setStatus(panel, "快捷预设已保存", "ok");
  }
}

function syncSideUi(root) {
  const sellBtn = root.querySelector("[data-side='sell']");
  if (sellBtn) {
    sellBtn.disabled = !lastPosition.hasPosition;
    sellBtn.title = lastPosition.hasPosition ? "" : "FOMO 没有这个币的仓位";
  }

  let side = currentSide(root);
  if (side === "sell" && !lastPosition.hasPosition) {
    root.querySelectorAll("[data-side]").forEach((b) => {
      b.classList.remove("on-buy", "on-sell");
    });
    root.querySelector("[data-side='buy']")?.classList.add("on-buy");
    side = "buy";
  }

  const input = root.querySelector("[data-amount]");
  const unit = root.querySelector("[data-unit]");
  const go = root.querySelector(".go");
  const presets = root.querySelector(".presets");
  const avail = root.querySelector(".avail");
  const availUsd = side === "buy" ? Number(lastPosition.cashUsd) || 0 : Number(lastPosition.usd) || 0;
  if (avail) avail.textContent = `可用 $${formatUsdQty(availUsd)}`;
  if (side === "buy") {
    input.value = formatPreset(lastUsd);
    input.readOnly = false;
    unit.textContent = "USD";
    go.className = "go buy";
    go.disabled = false;
    go.textContent = `确认买入 $${formatPreset(lastUsd)}`;
    presets.innerHTML = buyPresets
      .map((n) => `<button type="button" data-p="${formatPreset(n)}">$${formatPreset(n)}</button>`)
      .join("");
  } else {
    const usd = sellSliceUsd();
    input.value = formatUsdQty(usd);
    input.readOnly = true;
    unit.textContent = "USD";
    go.className = "go sell";
    go.disabled = false;
    go.textContent = `确认卖出 ${formatPreset(lastPercent)}%`;
    presets.innerHTML = sellPresets
      .map((n) => `<button type="button" data-p="${formatPreset(n)}">${formatPreset(n)}%</button>`)
      .join("");
  }
}

async function refreshPosition(token) {
  if (!token || positionBusy) return;
  const key = `${token.gmgnChain}:${token.address.toLowerCase()}`;
  positionBusy = true;
  try {
    const res = await chrome.runtime.sendMessage({
      type: "FOMO_POSITION",
      address: token.address,
      gmgnChain: token.gmgnChain,
      fomoUrl: token.fomoUrl,
    });
    if (positionKey && positionKey !== key) return;
    lastPosition = {
      hasPosition: Boolean(res?.hasPosition),
      usd: Number(res?.usd) || 0,
      tokenAmount: Number(res?.tokenAmount) || 0,
      symbol: String(res?.symbol || ""),
      cashUsd: Number(res?.cashUsd) || 0,
    };
  } catch {
    if (positionKey === key) {
      lastPosition = { hasPosition: false, usd: 0, tokenAmount: 0, symbol: "", cashUsd: 0 };
    }
  } finally {
    positionBusy = false;
  }
  const root = document.getElementById(HOST_ID)?.shadowRoot;
  if (root) syncSideUi(root);
}

function readSheetPresets(root) {
  const buys = [...root.querySelectorAll("[data-buy]")].map((el) => Number(el.value));
  const sells = [...root.querySelectorAll("[data-sell]")].map((el) => Number(el.value));
  if (buys.length !== 4 || sells.length !== 4) return { error: "需要四个买入、四个卖出" };
  for (const n of buys) {
    if (!Number.isFinite(n) || n < 1 || n > 20000) {
      return { error: "买入预设用 1–20000 USD" };
    }
  }
  for (const n of sells) {
    if (!Number.isFinite(n) || n < 1 || n > 100) {
      return { error: "卖出预设用 1–100%" };
    }
  }
  return { buy: buys, sell: sells };
}

function bindPanel(host, token) {
  const root = host.shadowRoot;
  host.dataset.address = token.address.toLowerCase();
  host.dataset.chain = token.gmgnChain;

  const input = root.querySelector("[data-amount]");
  const go = root.querySelector(".go");
  const presets = root.querySelector(".presets");

  const applyAmount = () => {
    const side = currentSide(root);
    const n = Number(input.value);
    if (side === "buy") {
      lastUsd = Number.isFinite(n) && n > 0 ? n : lastUsd;
      chrome.storage.local.set({ tapoverUsd: lastUsd });
      go.textContent = `确认买入 $${formatPreset(lastUsd)}`;
    }
  };

  root.querySelectorAll("[data-side]").forEach((btn) => {
    btn.onclick = async () => {
      if (btn.dataset.side === "sell") {
        if (btn.disabled) await refreshPosition(token);
        if (!lastPosition.hasPosition) return;
      }
      root.querySelectorAll("[data-side]").forEach((b) => {
        b.classList.remove("on-buy", "on-sell");
      });
      btn.classList.add(btn.dataset.side === "sell" ? "on-sell" : "on-buy");
      syncSideUi(root);
    };
  });

  input.oninput = applyAmount;
  presets.onclick = (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement) || !t.dataset.p) return;
    const side = currentSide(root);
    if (side === "sell") {
      const n = Number(t.dataset.p);
      if (!Number.isFinite(n) || n <= 0) return;
      lastPercent = Math.min(100, n);
      chrome.storage.local.set({ tapoverPercent: lastPercent });
      syncSideUi(root);
      return;
    }
    input.value = t.dataset.p;
    applyAmount();
  };

  root.querySelector(".gear").onclick = () => openPresetModal();

  go.onclick = async () => {
    applyAmount();
    const side = currentSide(root);
    if (side === "sell" && !lastPosition.hasPosition) {
      setStatus(root, "FOMO 没有这个币的仓位", "warn");
      return;
    }
    go.disabled = true;
    setStatus(root, side === "buy" ? "正在 FOMO 页填金额并确认买入…" : "正在 FOMO 页确认卖出…", "");
    try {
      const res = await chrome.runtime.sendMessage({
        type: "FOMO_SWAP",
        side,
        address: token.address,
        gmgnChain: token.gmgnChain,
        fomoUrl: token.fomoUrl,
        amountUsd: lastUsd,
        percent: lastPercent,
      });
      if (!res?.ok) {
        setStatus(root, res?.error || "下单失败", "err");
        return;
      }
      setStatus(root, "FOMO 已真正下单", "ok");
      refreshPosition(token);
    } catch (e) {
      setStatus(root, String(e?.message || e), "err");
    } finally {
      syncSideUi(root);
    }
  };
}

function createHost(token) {
  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>${panelStyles()}</style>
    <div class="wrap">
      <div class="row">
        <span class="brand">Tapover</span>
        <button class="gear" type="button" aria-label="快捷交易预设" title="快捷交易预设">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
      </div>
      <div class="sides">
        <button type="button" data-side="buy" class="on-buy">买入</button>
        <button type="button" data-side="sell">卖出</button>
      </div>
      <div class="amount-box">
        <label>数量</label>
        <input data-amount inputmode="decimal" value="20" />
        <span data-unit>USD</span>
      </div>
      <div class="presets"></div>
      <div class="avail">可用 $0.00</div>
      <button class="go buy" type="button">确认买入 $20</button>
      <div class="status"></div>
    </div>
  `;
  bindPanel(host, token);
  syncSideUi(shadow);
  return host;
}

async function prefetch(token) {
  const key = token.fomoUrl;
  if (key === lastPrefetchKey) return { ok: true, already: true };
  const host = document.getElementById(HOST_ID);
  const root = host?.shadowRoot;
  try {
    const res = await chrome.runtime.sendMessage({ type: "FOMO_PREFETCH", url: token.fomoUrl });
    if (res?.ok) {
      lastPrefetchKey = key;
      return res;
    }
    lastPrefetchKey = "";
    if (root) {
      if (res?.mode === "missing-tab") {
        setStatus(root, "没找到可复用的 FOMO 标签。打开并登录 https://fomo.family/r/0x_JBCat（不要只用 profile 页）", "warn");
      } else {
        setStatus(root, res?.error || "FOMO 预热失败，点确认仍会尝试下单", "warn");
      }
    }
    return res || { ok: false };
  } catch {
    lastPrefetchKey = "";
    if (root) setStatus(root, "扩展后台未响应，去 chrome://extensions 刷新本扩展", "err");
    return { ok: false };
  }
}

async function refreshStatus(token) {
  const key = `${token.gmgnChain}:${token.address.toLowerCase()}`;
  if (key === lastStatusKey) return;
  lastStatusKey = key;
  const host = document.getElementById(HOST_ID);
  const root = host?.shadowRoot;
  try {
    const res = await chrome.runtime.sendMessage({ type: "FOMO_STATUS" });
    if (!root) return;
    if (res?.hasAuth) {
      return;
    } else if (res?.ok) {
      setStatus(root, "找到 FOMO 标签，但还没登录态。在 FOMO 里点一下任意页。", "warn");
    } else {
      setStatus(root, res?.error || "打开并登录 https://fomo.family/r/0x_JBCat，再刷新那一页", "warn");
    }
  } catch {
    if (root) setStatus(root, "扩展后台未响应，去 chrome://extensions 刷新本扩展", "err");
  }
}

async function inject() {
  const gen = ++injectGen;
  const token = parseToken();
  const existing = document.getElementById(HOST_ID);

  if (!token) {
    existing?.remove();
    destroyPresetModal();
    lastStatusKey = "";
    lastPrefetchKey = "";
    return;
  }

  const card = findTradeCard();
  if (!card) return;

  await presetsReady;
  if (gen !== injectGen) return;

  const key = `${token.gmgnChain}:${token.address.toLowerCase()}`;
  if (positionKey !== key) {
    positionKey = key;
    lastPosition = { hasPosition: false, usd: 0, tokenAmount: 0, symbol: "", cashUsd: 0 };
  }

  if (existing && card.nextElementSibling === existing) {
    if (existing.dataset.address !== token.address.toLowerCase()) {
      bindPanel(existing, token);
    }
  } else {
    existing?.remove();
    const host = createHost(token);
    card.insertAdjacentElement("afterend", host);
  }

  const res = await prefetch(token);
  if (gen !== injectGen) return;
  if (!res?.ok) refreshStatus(token);
  refreshPosition(token);
}

function scheduleInject() {
  clearTimeout(routeTimer);
  routeTimer = setTimeout(inject, 80);
}

function hookSpa() {
  const wrap = (fn) =>
    function patched(...args) {
      const ret = fn.apply(this, args);
      scheduleInject();
      return ret;
    };
  history.pushState = wrap(history.pushState.bind(history));
  history.replaceState = wrap(history.replaceState.bind(history));
  window.addEventListener("popstate", scheduleInject);
}

function watchDom() {
  observer?.disconnect();
  observer = new MutationObserver(() => {
    const token = parseToken();
    if (!token) return;
    const card = findTradeCard();
    const host = document.getElementById(HOST_ID);
    if (!card) return;
    const moved = !host || card.nextElementSibling !== host;
    const switched = host && host.dataset.address !== token.address.toLowerCase();
    if (moved || switched) scheduleInject();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function watchRoute() {
  lastHref = location.href;
  setInterval(() => {
    const href = location.href;
    const token = parseToken();
    const host = document.getElementById(HOST_ID);
    const routeChanged = href !== lastHref;
    lastHref = href;
    const switched = Boolean(
      token && host && host.dataset.address !== token.address.toLowerCase()
    );
    const unsynced = Boolean(token && lastPrefetchKey !== token.fomoUrl);
    if (routeChanged || switched) {
      scheduleInject();
      return;
    }
    if (unsynced) prefetch(token);
  }, 400);
}

try {
  navigation.addEventListener("navigate", scheduleInject);
} catch {
  /* older Chromium */
}

hookSpa();
watchDom();
watchRoute();
setInterval(() => {
  const token = parseToken();
  const host = document.getElementById(HOST_ID);
  if (!token || !host) return;
  refreshPosition(token);
}, 8000);
inject();
