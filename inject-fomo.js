/**
 * MAIN world on fomo.family. Does not pick Solana/EVM rails itself.
 * Tapover：GMGN 点确认后，在已经打开的 FOMO 代币页上填金额、点 FOMO 自己的买入/卖出。
 * 资金用哪条稳定币（Robinhood USDG 等）由 FOMO 网页决定。
 */
(function () {
  const w = /** @type {Window & { __tapover?: boolean }} */ (window);
  if (w.__tapover) return;
  w.__tapover = true;

  const CHANNEL = "tapover";
  let bearer = "";
  let lastApiError = "";
  let lastSwapOk = false;
  let lastUserId = "";
  let lastBalances = null;
  let navGen = 0;
  const FOMO_API = "https://prod-api.fomo.family";

  function looksLikeJwt(s) {
    return typeof s === "string" && /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(s);
  }

  function takeBearer(value) {
    if (typeof value !== "string" || value.length < 20) return;
    const v = value.startsWith("Bearer ") ? value.slice(7) : value;
    if (looksLikeJwt(v)) bearer = v;
  }

  function scanHeaders(headers) {
    if (!headers) return;
    if (typeof Headers !== "undefined" && headers instanceof Headers) {
      takeBearer(headers.get("Authorization") || headers.get("authorization") || "");
      return;
    }
    if (Array.isArray(headers)) {
      for (const pair of headers) {
        if (String(pair[0]).toLowerCase() === "authorization") takeBearer(String(pair[1]));
      }
      return;
    }
    if (typeof headers === "object") {
      for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === "authorization") takeBearer(String(v));
      }
    }
  }

  function walkForJwt(val, depth) {
    if (depth > 6 || !val) return;
    if (looksLikeJwt(val)) {
      takeBearer(val);
      return;
    }
    if (typeof val === "string") {
      try {
        walkForJwt(JSON.parse(val), depth + 1);
      } catch {
        /* ignore */
      }
      return;
    }
    if (typeof val !== "object") return;
    if (Array.isArray(val)) {
      for (const item of val) walkForJwt(item, depth + 1);
      return;
    }
    for (const v of Object.values(val)) walkForJwt(v, depth + 1);
  }

  function harvestPrivyStorage() {
    try {
      for (const store of [localStorage, sessionStorage]) {
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (!k || !/privy|fomo|auth/i.test(k)) continue;
          walkForJwt(store.getItem(k), 0);
        }
      }
    } catch {
      /* ignore */
    }
  }

  function noteApiError(url, text) {
    const u = String(url || "");
    if (!/fomo\.family|relay\.link|hudson/.test(u)) return;
    const slice = String(text || "").slice(0, 240);
    if (/fast fill is not enabled/i.test(slice)) return;
    if (slice) lastApiError = slice;
  }

  const origFetch = window.fetch.bind(window);
  window.fetch = function (...args) {
    const req = args[0];
    const init = args[1];
    try {
      if (typeof Request !== "undefined" && req instanceof Request) scanHeaders(req.headers);
      if (init && typeof init === "object") scanHeaders(init.headers);
    } catch {
      /* ignore */
    }
    const p = origFetch(...args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0] && args[0].url;
      const method =
        (init && init.method) ||
        (typeof Request !== "undefined" && req instanceof Request && req.method) ||
        "GET";
      p.then(async (res) => {
        const u = String(url || "");
        const userMatch = u.match(/\/v2\/users\/([^/?#]+)/);
        if (userMatch) lastUserId = decodeURIComponent(userMatch[1]);
        if (/\/balances(?:[/?#]|$)/.test(u) && res.ok) {
          try {
            const json = await res.clone().json();
            lastBalances = json.responseObject || json;
          } catch {
            /* ignore */
          }
        }
        if (/\/swaps/i.test(u) && String(method).toUpperCase() !== "GET") {
          if (res.ok) lastSwapOk = true;
        }
        if (res.ok) return;
        const copy = res.clone();
        const body = await copy.text().catch(() => "");
        noteApiError(url, body || res.statusText);
      }).catch(() => {});
    } catch {
      /* ignore */
    }
    return p;
  };

  harvestPrivyStorage();

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function visible(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function isAmountInput(input) {
    const row = input.parentElement;
    if (!row) return false;
    const txt = row.textContent || "";
    return txt.includes("$") || input.placeholder === "0";
  }

  function pickConfirmButton(buttons, tabs) {
    const tabSet = new Set(tabs);
    const h11 = buttons.filter((b) => /h-11/.test(b.className) && !tabSet.has(b));
    if (h11.length) return h11[h11.length - 1];
    const big = buttons.filter((b) => !tabSet.has(b) && b.getBoundingClientRect().height >= 40);
    return big.length ? big[big.length - 1] : null;
  }

  function findTradeCard() {
    const inputs = [...document.querySelectorAll("input")].filter(visible);
    const ordered = [...inputs.filter(isAmountInput), ...inputs.filter((el) => !isAmountInput(el))];
    for (const input of ordered) {
      let card = input.parentElement;
      for (let i = 0; i < 8 && card; i++) {
        const buttons = [...card.querySelectorAll("button")].filter(visible);
        const tabs = buttons.filter((b) => /font-bold/.test(b.className) && /flex-1/.test(b.className));
        const confirm = pickConfirmButton(buttons, tabs);
        if (confirm && (tabs.length >= 2 || /h-11/.test(confirm.className))) {
          return { card, input, confirm, tabs, buttons };
        }
        card = card.parentElement;
      }
    }
    return null;
  }

  async function waitTokenTradeCard(address, timeoutMs) {
    const needle = String(address || "").toLowerCase();
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const onPage = !needle || location.href.toLowerCase().includes(needle);
      if (onPage) {
        const found = findTradeCard();
        if (found) return found;
      }
      await sleep(150);
    }
    throw new Error("FOMO 代币页还没出买卖卡。确认标签已打开这个币，并已登录。");
  }

  function click(el) {
    if (!el) return;
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, composed: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    el.click();
  }

  function getFiber(el) {
    if (!el) return null;
    for (const k of Object.keys(el)) {
      if (k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance")) return el[k];
    }
    return null;
  }

  function looksLikeRouter(obj) {
    return Boolean(
      obj &&
        typeof obj.navigate === "function" &&
        obj.state &&
        obj.state.location
    );
  }

  function walkRouter(start) {
    const seen = new Set();
    const stack = start ? [start] : [];
    let n = 0;
    while (stack.length && n++ < 12000) {
      const f = stack.pop();
      if (!f || seen.has(f)) continue;
      seen.add(f);
      const props = f.memoizedProps || f.pendingProps;
      if (looksLikeRouter(props && props.router)) return props.router;
      if (looksLikeRouter(f.stateNode && f.stateNode.router)) return f.stateNode.router;
      if (looksLikeRouter(f.memoizedState && f.memoizedState.router)) return f.memoizedState.router;
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
    }
    return null;
  }

  function fiberFromEl(el) {
    const direct = getFiber(el);
    if (direct) return direct;
    if (!el) return null;
    for (const k of Object.keys(el)) {
      if (k.startsWith("__reactContainer$")) {
        const root = el[k];
        return (root && root.stateNode && root.stateNode.current) || root;
      }
    }
    return null;
  }

  function findRouterInFiber() {
    const nodes = [document.body, document.documentElement];
    if (document.body) nodes.push(...document.body.children);
    for (const el of nodes) {
      const found = walkRouter(fiberFromEl(el));
      if (found) return found;
    }
    return null;
  }

  function getRouter() {
    const w = window;
    if (looksLikeRouter(w.__reactRouterDataRouter)) return w.__reactRouterDataRouter;
    if (looksLikeRouter(w.__remixRouter)) return w.__remixRouter;
    return findRouterInFiber();
  }

  function parseDest(url) {
    try {
      const u = new URL(url, location.origin);
      if (u.origin !== location.origin) return null;
      return u;
    } catch {
      return null;
    }
  }

  function samePath(href, destHref) {
    try {
      const a = new URL(href, location.origin);
      const b = new URL(destHref, location.origin);
      return a.pathname.replace(/\/$/, "") === b.pathname.replace(/\/$/, "");
    } catch {
      return false;
    }
  }

  async function waitRouter(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const router = getRouter();
      if (router) return router;
      await sleep(80);
    }
    return getRouter();
  }

  async function spaNavigate(url) {
    const dest = parseDest(url);
    if (!dest) return { ok: false, mode: "bad-url" };
    const to = dest.pathname + dest.search + dest.hash;
    if (samePath(location.href, dest.href)) return { ok: true, mode: "already" };

    const gen = ++navGen;
    const router = await waitRouter(4000);
    if (gen !== navGen) return { ok: false, mode: "superseded" };
    if (!router || typeof router.navigate !== "function") {
      return { ok: false, mode: "no-router" };
    }

    try {
      await router.navigate(to);
    } catch (err) {
      if (gen !== navGen) return { ok: false, mode: "superseded" };
      return {
        ok: false,
        mode: "navigate-error",
        error: String(err && err.message ? err.message : err),
      };
    }

    const start = Date.now();
    while (Date.now() - start < 8000) {
      if (gen !== navGen) return { ok: false, mode: "superseded" };
      if (samePath(location.href, dest.href)) return { ok: true, mode: "spa" };
      await sleep(50);
    }
    if (gen !== navGen) return { ok: false, mode: "superseded" };
    if (samePath(location.href, dest.href)) return { ok: true, mode: "spa" };
    return { ok: false, mode: "timeout" };
  }

  function invokeReactClick(el) {
    let f = getFiber(el);
    for (let i = 0; i < 24 && f; i++) {
      const props = f.memoizedProps || f.pendingProps;
      if (props && typeof props.onClick === "function") {
        try {
          props.onClick({
            preventDefault() {},
            stopPropagation() {},
            nativeEvent: { isTrusted: true },
            target: el,
            currentTarget: el,
          });
        } catch {
          /* FOMO handler threw; DOM click already fired */
        }
        return true;
      }
      f = f.return;
    }
    return false;
  }

  function pressConfirm(el, useFiber) {
    click(el);
    if (useFiber) invokeReactClick(el);
  }

  function pickTab(ui, side) {
    const wantBuy = side !== "sell";
    const tabs = ui.tabs.length >= 2 ? ui.tabs.slice(0, 2) : ui.buttons.slice(0, 2);
    const buy = tabs[0];
    const sell = tabs[1];
    const target = wantBuy ? buy : sell;
    if (target) click(target);
  }

  function pickSellPreset(ui, percent) {
    const n = Math.round(Number(percent) || 100);
    const labels = [`${n}%`, String(n)];
    if (n >= 100) labels.push("MAX", "Max");
    const btns = [...ui.card.querySelectorAll("button")].filter(visible);
    for (const label of labels) {
      const hit = btns.find((b) => (b.textContent || "").trim() === label);
      if (hit && !hit.disabled) {
        click(hit);
        return true;
      }
    }
    return false;
  }

  function pickBuyPreset(ui, usd) {
    const n = Number(usd);
    if (!Number.isFinite(n)) return false;
    const labels = [`$${Number.isInteger(n) ? n : n}`, `$${Math.round(n)}`];
    const btns = [...ui.card.querySelectorAll("button")].filter(visible);
    for (const label of labels) {
      const hit = btns.find((b) => (b.textContent || "").trim() === label);
      if (hit && !hit.disabled) {
        click(hit);
        return true;
      }
    }
    return false;
  }

  function ackWarnings(card) {
    const boxes = [...card.querySelectorAll('[role="checkbox"], input[type="checkbox"]')].filter(visible);
    let clicked = false;
    for (const el of boxes) {
      const checked =
        el.getAttribute("aria-checked") === "true" ||
        (el instanceof HTMLInputElement && el.checked);
      if (checked) continue;
      click(el);
      clicked = true;
    }
    return clicked;
  }

  function inputStillFilled(ui, side, expected) {
    if (!ui || side !== "buy") return false;
    const raw = String(ui.input.value || "").replace(/[$,\s]/g, "");
    const n = Number(raw);
    return Number.isFinite(n) && Math.abs(n - expected) < 0.01;
  }

  async function waitConfirmReady(getUi, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ui = getUi();
      if (ui && !ui.confirm.disabled) return ui;
      await sleep(250);
    }
    throw new Error("FOMO 确认按钮一直是灰的。可能余额不够、价格冲击要勾确认，或报价还没出来。");
  }

  function cardLooksError(card) {
    const txt = (card.innerText || "").slice(0, 800);
    if (/insufficient|not enough|余额不足|blocked|failed|失败/i.test(txt)) return txt.slice(0, 160);
    return "";
  }

  async function executeViaFomoUi(payload) {
    lastApiError = "";
    lastSwapOk = false;
    harvestPrivyStorage();
    const side = payload.side === "sell" ? "sell" : "buy";
    const usd = Number(payload.amountUsd);
    let ui = await waitTokenTradeCard(payload.address, 20000);
    pickTab(ui, side);
    await sleep(300);
    ui = findTradeCard() || ui;

    if (side === "buy") {
      if (!Number.isFinite(usd) || usd < 1 || usd > 20000) {
        throw new Error("买入金额用 1–20000 USD");
      }
      const raw = String(Number.isInteger(usd) ? usd : usd);
      if (!pickBuyPreset(ui, usd)) {
        ui.input.focus();
        setNativeValue(ui.input, raw);
      }
    } else {
      const percent = Math.min(100, Math.max(1, Number(payload.percent) || 100));
      if (!pickSellPreset(ui, percent)) {
        throw new Error("FOMO 卖出预设点不到。把 FOMO 标签拉到前台看一眼再试。");
      }
    }

    await sleep(500);
    if (ui.card && ackWarnings(ui.card)) await sleep(250);
    ui = await waitConfirmReady(() => findTradeCard(), 20000);
    if (ackWarnings(ui.card)) {
      await sleep(250);
      ui = await waitConfirmReady(() => findTradeCard(), 8000);
    }

    if (ui.confirm.disabled) {
      throw new Error(cardLooksError(ui.card) || "FOMO 确认按钮仍不可点。");
    }

    pressConfirm(ui.confirm);

    const started = Date.now();
    let sawProcessing = false;
    let retried = false;
    while (Date.now() - started < 45000) {
      await sleep(400);
      const now = findTradeCard();
      const label = ((now && now.confirm.textContent) || "").trim();
      if (/process|ing|…|\.\.\./i.test(label) || (now && now.confirm.disabled)) sawProcessing = true;
      if (lastApiError && !/fast fill is not enabled/i.test(lastApiError)) {
        let msg = lastApiError;
        try {
          const j = JSON.parse(lastApiError);
          msg = j.message || lastApiError;
        } catch {
          /* keep */
        }
        throw new Error(String(msg).slice(0, 180));
      }
      const err = now ? cardLooksError(now.card) : "";
      if (err) throw new Error(err);
      if (lastSwapOk) return { ok: true, path: "fomo-ui" };
      if (sawProcessing && now && !now.confirm.disabled && !/process/i.test(label)) {
        return { ok: true, path: "fomo-ui" };
      }
      if (
        side === "buy" &&
        now &&
        !inputStillFilled(now, side, usd) &&
        (sawProcessing || lastSwapOk || Date.now() - started > 1200)
      ) {
        return { ok: true, path: "fomo-ui" };
      }
      if (!retried && Date.now() - started > 1800 && now && !now.confirm.disabled && inputStillFilled(now, side, usd)) {
        retried = true;
        if (ackWarnings(now.card)) await sleep(200);
        pressConfirm(now.confirm, true);
      }
      if (Date.now() - started > 8000 && now && inputStillFilled(now, side, usd) && !sawProcessing && !lastSwapOk) {
        throw new Error("FOMO 买入按钮已点，但没有真正下单。把 FOMO 标签拉到前台看是否要签名或勾价格冲击。");
      }
    }
    if (lastSwapOk || sawProcessing) return { ok: true, path: "fomo-ui" };
    throw new Error("FOMO 没有确认成交。刷新 FOMO 代币页后再从 GMGN 点一次。");
  }

  function normAddr(a) {
    const s = String(a || "");
    return /^0x[a-fA-F0-9]{40}$/.test(s) ? s.toLowerCase() : s;
  }

  function pickUserId(obj, depth) {
    if (!obj || typeof obj !== "object" || depth > 4) return "";
    if (obj.fomoUser && obj.fomoUser.id) return String(obj.fomoUser.id);
    if (obj.id != null && (obj.handle || obj.username) && (obj.numTrades != null || obj.evmWallet || obj.walletAddress)) {
      return String(obj.id);
    }
    return "";
  }

  function findFomoUserId() {
    if (lastUserId) return lastUserId;
    const rootEl = document.getElementById("root") || document.body;
    const start = getFiber(rootEl) || getFiber(rootEl.firstElementChild);
    const seen = new Set();
    let n = 0;
    const stack = start ? [start] : [];
    while (stack.length) {
      const f = stack.pop();
      if (!f || seen.has(f) || n++ > 8000) continue;
      seen.add(f);
      const id = pickUserId(f.memoizedProps, 0) || pickUserId(f.pendingProps, 0) || pickUserId(f.memoizedState, 0);
      if (id) {
        lastUserId = id;
        return id;
      }
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
    }
    return lastUserId;
  }

  function balancesList() {
    const raw = lastBalances;
    if (!raw) return [];
    if (Array.isArray(raw.balances)) return raw.balances;
    if (Array.isArray(raw)) return raw;
    return [];
  }

  function matchBalance(address, networkId) {
    const addr = normAddr(address);
    const nid = Number(networkId);
    for (const row of balancesList()) {
      const b = row && row.balance ? row.balance : row;
      if (!b) continue;
      const tokenId = String(b.tokenId || "");
      const tokAddr = normAddr(b.tokenAddress || (row.userToken && row.userToken.tokenAddress) || "");
      const tokNid = Number(b.networkId ?? (row.userToken && row.userToken.networkId));
      if (tokenId === `${addr}:${nid}`) return row;
      if (addr && tokenId.toLowerCase().startsWith(addr.toLowerCase()) && tokenId.endsWith(`:${nid}`)) return row;
      if (tokAddr && tokAddr === addr && (!tokNid || tokNid === nid)) return row;
    }
    return null;
  }

  async function fetchBalances() {
    harvestPrivyStorage();
    const userId = findFomoUserId();
    if (!userId) return lastBalances;
    const headers = {};
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    try {
      const res = await origFetch(`${FOMO_API}/v2/users/${encodeURIComponent(userId)}/balances`, {
        headers,
        credentials: "include",
      });
      if (!res.ok) return lastBalances;
      const json = await res.json();
      lastBalances = json.responseObject || json;
      lastUserId = userId;
    } catch {
      /* ignore */
    }
    return lastBalances;
  }

  const RH_CHAIN = 4663;
  const RH_USDG_ID = "0x5fc5360d0400a0fd4f2af552add042d716f1d168:4663";
  const RH_USDG_ADDR = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
  const FOMO_RH_QUOTE_ID = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v:1399811149";
  const FOMO_RH_QUOTE_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

  function cashAmount(row) {
    const b = row && row.balance ? row.balance : row;
    if (!b) return 0;
    const n = Number(b.shiftedBalance);
    if (Number.isFinite(n) && n > 0) return n;
    const price = Number((row.tokenFilterResult && row.tokenFilterResult.priceUSD) || 1);
    const raw = Number(b.balance);
    return Number.isFinite(raw) && raw > 0 && price > 0 ? raw * price : 0;
  }

  function rowTokenId(row) {
    const b = row && row.balance ? row.balance : row;
    return String((b && b.tokenId) || row.tokenId || "");
  }

  function isRhUsdg(row) {
    const b = row && row.balance ? row.balance : row;
    if (!b) return false;
    const tokenId = rowTokenId(row).toLowerCase();
    const addr = normAddr(b.tokenAddress || (row.userToken && row.userToken.tokenAddress) || "");
    const nid = Number(b.networkId ?? (row.userToken && row.userToken.networkId));
    const sym = String((row.userToken && row.userToken.symbol) || (row.tokenFilterResult && row.tokenFilterResult.symbol) || "").toUpperCase();
    return (
      tokenId === RH_USDG_ID ||
      addr === RH_USDG_ADDR ||
      (nid === RH_CHAIN && (sym === "USDG" || addr === RH_USDG_ADDR))
    );
  }

  function isFomoRhQuote(row) {
    const tokenId = rowTokenId(row);
    return tokenId === FOMO_RH_QUOTE_ID || tokenId.startsWith(FOMO_RH_QUOTE_MINT);
  }

  function readCashUsd(networkId) {
    let quote = 0;
    let usdg = 0;
    for (const row of balancesList()) {
      const amt = cashAmount(row);
      if (!amt) continue;
      if (isRhUsdg(row)) usdg += amt;
      if (isFomoRhQuote(row)) quote += amt;
    }
    if (networkId === RH_CHAIN || !networkId) return quote > 0 ? quote : usdg;
    return quote > 0 ? quote : usdg;
  }

  function positionFromRow(row) {
    const b = row && row.balance ? row.balance : row || {};
    const shifted = Number(b.shiftedBalance ?? 0);
    const price = Number((row && row.tokenFilterResult && row.tokenFilterResult.priceUSD) || 0);
    const usd = Number.isFinite(shifted * price) ? shifted * price : 0;
    const symbol =
      (row && row.userToken && row.userToken.symbol) ||
      (row && row.tokenFilterResult && row.tokenFilterResult.symbol) ||
      "";
    const hasPosition = shifted > 0;
    return {
      ok: true,
      hasPosition,
      tokenAmount: shifted,
      usd,
      symbol: String(symbol || ""),
    };
  }

  async function readPosition(payload) {
    const address = String((payload && payload.address) || "");
    const networkId = Number((payload && payload.networkId) || 0);
    if (!address || !networkId) return { ok: false, hasPosition: false, error: "缺少地址" };
    if (!matchBalance(address, networkId)) await fetchBalances();
    if (!lastBalances) {
      for (let i = 0; i < 6 && !lastBalances; i++) {
        await sleep(400);
        if (!lastBalances) await fetchBalances();
      }
    }
    const cashUsd = readCashUsd(networkId);
    const row = matchBalance(address, networkId);
    if (!row) {
      return { ok: true, hasPosition: false, tokenAmount: 0, usd: 0, symbol: "", cashUsd };
    }
    return Object.assign(positionFromRow(row), { cashUsd });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.channel !== CHANNEL || d.dir !== "to-page") return;
    const requestId = d.requestId;
    const reply = (payload) => {
      window.postMessage({ channel: CHANNEL, dir: "from-page", requestId, payload }, "*");
    };

    if (d.type === "PING") {
      harvestPrivyStorage();
      reply({ ok: true, hasAuth: Boolean(bearer) || document.cookie.length > 0 });
      return;
    }

    if (d.type === "POSITION") {
      readPosition(d.payload || {})
        .then((result) => reply(result))
        .catch((err) => reply({ ok: false, hasPosition: false, error: String(err && err.message ? err.message : err) }));
      return;
    }

    if (d.type === "NAVIGATE") {
      spaNavigate((d.payload && d.payload.url) || "")
        .then((result) => reply(result))
        .catch((err) => reply({ ok: false, mode: "error", error: String(err && err.message ? err.message : err) }));
      return;
    }

    if (d.type !== "SWAP") return;
    executeViaFomoUi(d.payload || {})
      .then((result) => reply(result))
      .catch((err) => reply({ ok: false, error: String(err && err.message ? err.message : err) }));
  });
})();
