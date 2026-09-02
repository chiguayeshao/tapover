const CHANNEL = "tapover";
const pending = new Map();

chrome.runtime.sendMessage({ type: "FOMO_ENSURE_INJECT" }).catch(() => {});

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const d = event.data;
  if (!d || d.channel !== CHANNEL || d.dir !== "from-page") return;
  const waiter = pending.get(d.requestId);
  if (!waiter) return;
  pending.delete(d.requestId);
  waiter(d.payload);
});

function callPage(type, payload, timeoutMs) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("FOMO 页没有响应。刷新 FOMO 标签后再试。"));
    }, timeoutMs);
    pending.set(requestId, (res) => {
      clearTimeout(t);
      resolve(res);
    });
    window.postMessage(
      { channel: CHANNEL, dir: "to-page", type, requestId, payload },
      "*"
    );
  });
}

const PAGE_CALL = {
  FOMO_PING: ["PING", 4000],
  FOMO_SWAP: ["SWAP", 90000],
  FOMO_POSITION: ["POSITION", 12000],
  FOMO_NAVIGATE: ["NAVIGATE", 16000],
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const mapped = msg && PAGE_CALL[msg.type];
  if (!mapped) return;
  const [type, timeout] = mapped;
  callPage(type, msg.payload || {}, timeout)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});
