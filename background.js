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
      default:
        sendResponse({ ok: false, error: chrome.i18n.getMessage("unknownRequest") || "Unknown request." });
    }
  })().catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const all = await chrome.storage.session.get(null);
  const keys = Object.keys(all).filter(
    (key) => key === stateKey(tabId) || key.startsWith(`drawing:${tabId}:`)
  );
  if (keys.length) await chrome.storage.session.remove(keys);
});
