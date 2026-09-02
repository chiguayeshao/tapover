const FOMO_URL_PATTERNS = [
  "https://fomo.family/*",
  "https://www.fomo.family/*",
];

const STORAGE_KEY = "tapoverTabId";

const NETWORK_ID = {
  robinhood: 4663,
  sol: 1399811149,
  base: 8453,
  bsc: 56,
  eth: 1,
  monad: 143,
};

function isFomoHost(hostname) {
  return hostname === "fomo.family" || hostname === "www.fomo.family";
}

function tabHref(tab) {
  return tab?.url || tab?.pendingUrl || "";
}

function isProtectedFomoPath(pathname) {
  return (
    pathname.startsWith("/profile") ||
    pathname.startsWith("/export-key") ||
    pathname.startsWith("/delete-account") ||
    pathname.startsWith("/terms") ||
    pathname.startsWith("/privacy") ||
    pathname.startsWith("/careers") ||
    pathname.startsWith("/download")
  );
}

function isReusableFomoUrl(url) {
  try {
    const u = new URL(url);
    if (!isFomoHost(u.hostname)) return false;
    return !isProtectedFomoPath(u.pathname);
  } catch {
    return false;
  }
}

function sameTokenUrl(a, b) {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return (
      isFomoHost(ua.hostname) &&
      isFomoHost(ub.hostname) &&
      ua.pathname.replace(/\/$/, "") === ub.pathname.replace(/\/$/, "")
    );
  } catch {
    return false;
  }
}

async function getBridgeTabId() {
  const { [STORAGE_KEY]: id } = await chrome.storage.session.get(STORAGE_KEY);
  return typeof id === "number" ? id : null;
}

async function setBridgeTabId(id) {
  await chrome.storage.session.set({ [STORAGE_KEY]: id });
}

async function listFomoTabs() {
  const tabs = await chrome.tabs.query({ url: FOMO_URL_PATTERNS });
  const host = tabs.filter((t) => {
    const href = tabHref(t);
    if (!href) return false;
    try {
      return isFomoHost(new URL(href).hostname);
    } catch {
      return false;
    }
  });
  host.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  const reusable = host.filter((t) => isReusableFomoUrl(tabHref(t)));
  return { host, reusable };
}

async function findFomoTab() {
  const remembered = await getBridgeTabId();
  if (remembered != null) {
    try {
      const tab = await chrome.tabs.get(remembered);
      const href = tabHref(tab);
      if (tab && href && isFomoHost(new URL(href).hostname)) return tab;
    } catch {
      await chrome.storage.session.remove(STORAGE_KEY);
    }
  }
  const { host, reusable } = await listFomoTabs();
  return reusable[0] || host[0] || null;
}

async function findPrefetchTab() {
  const remembered = await getBridgeTabId();
  if (remembered != null) {
    try {
      const tab = await chrome.tabs.get(remembered);
      const href = tabHref(tab);
      if (tab && (!href || isReusableFomoUrl(href))) return tab;
    } catch {
      await chrome.storage.session.remove(STORAGE_KEY);
    }
  }
  const { reusable } = await listFomoTabs();
  return reusable[0] || null;
}

async function ensureInject(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["inject-fomo.js"],
  });
}


async function waitTabComplete(tabId, timeoutMs, expectedUrl) {
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }, timeoutMs);
    function onUpdated(id, info, tab) {
      if (id !== tabId || info.status !== "complete") return;
      const url = tab?.url || info.url || "";
      if (expectedUrl && url && !sameTokenUrl(url, expectedUrl)) return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function pingFomoTab(tab) {
  await ensureInject(tab.id);
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: "FOMO_PING" });
  } catch {
    return { ok: false, error: "FOMO 标签还没加载扩展脚本，刷新那一页。" };
  }
}

async function trySpaNavigate(tabId, fomoUrl) {
  await ensureInject(tabId);
  try {
    return await chrome.tabs.sendMessage(tabId, {
      type: "FOMO_NAVIGATE",
      payload: { url: fomoUrl },
    });
  } catch {
    return null;
  }
}

async function navigateFomoTab(tab, fomoUrl, activate) {
  const current = tabHref(tab);
  if (current && sameTokenUrl(current, fomoUrl)) {
    if (activate) await chrome.tabs.update(tab.id, { active: true });
    return { ok: true, mode: "already", tabId: tab.id };
  }

  let res = await trySpaNavigate(tab.id, fomoUrl);
  if (!res?.ok && res?.mode !== "superseded" && tab.status && tab.status !== "complete") {
    await waitTabComplete(tab.id, 8000);
    res = await trySpaNavigate(tab.id, fomoUrl);
  }
  if (res?.ok) {
    if (activate) await chrome.tabs.update(tab.id, { active: true });
    return { ...res, tabId: tab.id };
  }
  if (res?.mode === "superseded") {
    return { ok: false, mode: "superseded", tabId: tab.id };
  }

  await chrome.tabs.update(tab.id, { url: fomoUrl, active: Boolean(activate) });
  await waitTabComplete(tab.id, 20000, fomoUrl);
  return { ok: true, mode: "hard", tabId: tab.id };
}

async function prefetchFomo(fomoUrl) {
  const existing = await findPrefetchTab();
  if (!existing) return { ok: false, mode: "missing-tab" };

  await setBridgeTabId(existing.id);
  return navigateFomoTab(existing, fomoUrl, false);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return;

  if (msg.type === "FOMO_ENSURE_INJECT") {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ ok: false });
      return true;
    }
    const href = sender.tab?.url || sender.url || "";
    const remember = !href || isReusableFomoUrl(href);
    (remember ? setBridgeTabId(tabId) : Promise.resolve())
      .then(() => ensureInject(tabId))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === "FOMO_PREFETCH") {
    const url = String(msg.url || "");
    if (!url.startsWith("https://fomo.family/") && !url.startsWith("https://www.fomo.family/")) {
      sendResponse({ ok: false, mode: "bad-url" });
      return true;
    }
    prefetchFomo(url)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, mode: "error", error: String(err) }));
    return true;
  }

  if (msg.type === "FOMO_STATUS") {
    findFomoTab()
      .then(async (tab) => {
        if (!tab) return { ok: false, mode: "missing-tab" };
        if (isReusableFomoUrl(tabHref(tab))) await setBridgeTabId(tab.id);
        const ping = await pingFomoTab(tab);
        return {
          ok: Boolean(ping?.ok),
          hasAuth: Boolean(ping?.hasAuth),
          error: ping?.error,
          tabId: tab.id,
        };
      })
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === "FOMO_POSITION") {
    const address = String(msg.address || "").trim();
    const gmgnChain = String(msg.gmgnChain || "").toLowerCase();
    const networkId = NETWORK_ID[gmgnChain];
    if (!address || !networkId) {
      sendResponse({ ok: false, hasPosition: false, error: "不支持的链或地址" });
      return true;
    }
    findPrefetchTab()
      .then(async (tab) => {
        if (!tab) return { ok: false, hasPosition: false, mode: "missing-tab" };
        await setBridgeTabId(tab.id);
        await ensureInject(tab.id);
        return chrome.tabs.sendMessage(tab.id, {
          type: "FOMO_POSITION",
          payload: { address, networkId },
        });
      })
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, hasPosition: false, error: String(err) }));
    return true;
  }

  if (msg.type === "FOMO_SWAP") {
    const side = msg.side === "sell" ? "sell" : "buy";
    const address = String(msg.address || "").trim();
    const fomoUrl = String(msg.fomoUrl || "");
    const gmgnChain = String(msg.gmgnChain || "").toLowerCase();
    const networkId = NETWORK_ID[gmgnChain];
    if (!address || !networkId) {
      sendResponse({ ok: false, error: "不支持的链或地址" });
      return true;
    }
    findPrefetchTab()
      .then(async (tab) => {
        if (!tab) return { ok: false, error: "没有可复用的 FOMO 标签。打开并登录 https://fomo.family/r/0x_JBCat（不要只用 profile 页）。" };
        await setBridgeTabId(tab.id);
        if (fomoUrl.startsWith("https://fomo.family/") || fomoUrl.startsWith("https://www.fomo.family/")) {
          const nav = await navigateFomoTab(tab, fomoUrl, true);
          if (nav?.mode === "hard") await new Promise((r) => setTimeout(r, 400));
        } else {
          await chrome.tabs.update(tab.id, { active: true });
        }
        await ensureInject(tab.id);
        return chrome.tabs.sendMessage(tab.id, {
          type: "FOMO_SWAP",
          payload: {
            side,
            address,
            networkId,
            amountUsd: msg.amountUsd,
            percent: msg.percent,
          },
        });
      })
      .then(sendResponse)
      .catch((err) => {
        const text = String(err?.message || err);
        const hint = /Receiving end does not exist/i.test(text)
          ? "刷新已登录的 FOMO 标签，再点买入。"
          : text;
        sendResponse({ ok: false, error: hint });
      });
    return true;
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const remembered = await getBridgeTabId();
  if (remembered === tabId) await chrome.storage.session.remove(STORAGE_KEY);
});
