importScripts("zip.js");

const DEFAULT_TOOL = {
  tool: "pen",
  color: "#ff4d6d",
  penSize: 6,
  eraserSize: 28,
  textSize: 28,
  opacity: 1,
  rightClickClear: true
};

const stateKey = (tabId) => `tab:${tabId}`;
const drawingKey = (tabId, url) => `drawing:${tabId}:${url}`;

async function getTabState(tabId) {
  const key = stateKey(tabId);
  const stored = await chrome.storage.session.get(key);
  return stored[key] ?? { enabled: false, mode: "draw" };
}

async function setTabState(tabId, patch) {
  const state = { ...(await getTabState(tabId)), ...patch };
  await chrome.storage.session.set({ [stateKey(tabId)]: state });
  return state;
}

async function getTool() {
  const { toolSettings } = await chrome.storage.local.get("toolSettings");
  const merged = { ...DEFAULT_TOOL, ...toolSettings };
  if (toolSettings?.size && !toolSettings.penSize) merged.penSize = toolSettings.size;
  if (typeof toolSettings?.doubleClickClear === "boolean" && typeof toolSettings?.rightClickClear !== "boolean") {
    merged.rightClickClear = toolSettings.doubleClickClear;
  }
  delete merged.size;
  delete merged.doubleClickClear;
  return merged;
}

// ---------------------------------------------------------------------------
// Sequence capture (owned by the service worker so it survives panel closure)
// ---------------------------------------------------------------------------
const MAX_SEQUENCE_FRAMES = 10;
const MAX_SEQUENCE_BYTES = 200 * 1024 * 1024;
const sequence = { tabId: null, windowId: null, frames: [], timer: null, running: false, capturing: false };

function setBadge(tabId, capturing) {
  try {
    if (capturing) {
      chrome.action.setBadgeText({ text: "REC", tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#df3652", tabId });
      chrome.action.setTitle({ title: chrome.i18n.getMessage("sequenceCapturing") || "Sequence capture in progress", tabId });
    } else {
      chrome.action.setBadgeText({ text: "", tabId });
      chrome.action.setTitle({ title: chrome.i18n.getMessage("extensionActionTitle") || "Open Markerly", tabId });
    }
  } catch { /* tab may already be gone */ }
}

function broadcast(payload) {
  chrome.runtime.sendMessage({ type: "SEQUENCE_STATUS", ...payload }).catch(() => {});
}

async function captureSequenceFrame() {
  if (!sequence.running || sequence.capturing || sequence.windowId == null) return;
  sequence.capturing = true;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(sequence.windowId, { format: "jpeg", quality: 90 });
    const bytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
    const totalBytes = sequence.frames.reduce((total, frame) => total + frame.bytes.length, 0);
    if (sequence.frames.length >= MAX_SEQUENCE_FRAMES || totalBytes + bytes.length > MAX_SEQUENCE_BYTES) {
      await stopSequenceCapture(chrome.i18n.getMessage("sequenceLimitReached") || "Limit reached");
      return;
    }
    const index = String(sequence.frames.length + 1).padStart(4, "0");
    sequence.frames.push({ name: `capture-${index}.jpg`, bytes, date: new Date() });
    broadcast({ frames: sequence.frames.length });
    if (sequence.frames.length >= MAX_SEQUENCE_FRAMES) {
      await stopSequenceCapture(chrome.i18n.getMessage("sequenceLimitReached") || "Limit reached");
    }
  } catch {
    await stopSequenceCapture(chrome.i18n.getMessage("sequenceInterrupted") || "Interrupted");
  } finally {
    sequence.capturing = false;
  }
}

async function startSequenceCapture(tabId, windowId) {
  sequence.tabId = tabId;
  sequence.windowId = windowId;
  sequence.frames = [];
  sequence.running = true;
  setBadge(tabId, true);
  broadcast({ running: true, frames: 0 });
  await captureSequenceFrame();
  if (!sequence.running) return;
  sequence.timer = setInterval(captureSequenceFrame, sequence.intervalMs ?? 3000);
}

async function stopSequenceCapture(statusMessage) {
  if (sequence.timer) { clearInterval(sequence.timer); sequence.timer = null; }
  sequence.running = false;
  const tabId = sequence.tabId;
  const frames = sequence.frames;
  sequence.frames = [];
  setBadge(tabId, false);
  broadcast({ running: false, frames: frames.length, statusMessage });

  if (!frames.length) {
    broadcast({ statusMessage: chrome.i18n.getMessage("noCaptures") || "No captures" });
    return;
  }
  try {
    const zip = globalThis.createZipBlob(frames);
    const url = URL.createObjectURL(zip);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await chrome.downloads.download({
      url,
      filename: `markerly/markerly-sequence-${stamp}.zip`,
      saveAs: false
    });
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    broadcast({ statusMessage: statusMessage || (chrome.i18n.getMessage("sequenceSaved") || "Saved") });
  } catch {
    broadcast({ statusMessage: chrome.i18n.getMessage("sequenceSaveFailed") || "Save failed" });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  const { toolSettings } = await chrome.storage.local.get("toolSettings");
  if (!toolSettings) await chrome.storage.local.set({ toolSettings: DEFAULT_TOOL });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const tabId = message.tabId ?? sender.tab?.id;
    if (!tabId) throw new Error(chrome.i18n.getMessage("tabNotFound") || "The active tab could not be found.");

    switch (message.type) {
      case "GET_CONTEXT": {
        const state = await getTabState(tabId);
        const tool = await getTool();
        const key = drawingKey(tabId, sender.tab?.url ?? message.url ?? "");
        const stored = await chrome.storage.session.get(key);
        sendResponse({ ok: true, state, tool, strokes: stored[key] ?? [] });
        break;
      }
      case "GET_TAB_STATE":
        sendResponse({ ok: true, state: await getTabState(tabId), tool: await getTool() });
        break;
      case "SET_TAB_STATE":
        sendResponse({ ok: true, state: await setTabState(tabId, message.patch) });
        break;
      case "SET_TOOL": {
        const tool = { ...DEFAULT_TOOL, ...message.tool };
        delete tool.size;
        delete tool.doubleClickClear;
        await chrome.storage.local.set({ toolSettings: tool });
        sendResponse({ ok: true, tool });
        break;
      }
      case "SAVE_DRAWING": {
        const key = drawingKey(tabId, sender.tab?.url ?? "");
        await chrome.storage.session.set({ [key]: message.strokes });
        sendResponse({ ok: true });
        break;
      }
      case "SEQUENCE_START":
        sequence.intervalMs = message.intervalMs ?? 3000;
        await startSequenceCapture(tabId, message.windowId);
        sendResponse({ ok: true });
        break;
      case "SEQUENCE_STOP":
        await stopSequenceCapture(chrome.i18n.getMessage("sequenceSaved") || "Saved");
        sendResponse({ ok: true });
        break;
      case "SEQUENCE_STATUS":
        sendResponse({ ok: true, running: sequence.running, frames: sequence.frames.length });
        break;
      default:
        sendResponse({ ok: false, error: chrome.i18n.getMessage("unknownRequest") || "Unknown request." });
    }
  })().catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // Stop sequence when the active tab changes (same as before).
  if (sequence.running && sequence.tabId !== activeInfo.tabId) {
    await stopSequenceCapture(chrome.i18n.getMessage("tabChanged") || "Tab changed");
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (sequence.running && sequence.tabId === tabId) {
    await stopSequenceCapture(chrome.i18n.getMessage("tabChanged") || "Tab closed");
  }
  const all = await chrome.storage.session.get(null);
  const keys = Object.keys(all).filter(
    (key) => key === stateKey(tabId) || key.startsWith(`drawing:${tabId}:`)
  );
  if (keys.length) await chrome.storage.session.remove(keys);
});