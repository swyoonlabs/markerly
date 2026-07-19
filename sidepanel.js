const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;

function localizeDocument() {
  document.documentElement.lang = chrome.i18n.getUILanguage().split("-")[0] || "en";
  $$('[data-i18n]').forEach((element) => { element.textContent = t(element.dataset.i18n); });
  $$('[data-i18n-html]').forEach((element) => { element.innerHTML = t(element.dataset.i18nHtml); });
  $$('[data-i18n-aria-label]').forEach((element) => { element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel)); });
}

const ui = {
  enabled: $("#enabled"), workspace: $("#workspace"), blocked: $("#blocked"),
  pageTitle: $("#pageTitle"), status: $("#status"), statusDot: $("#statusDot"),
  color: $("#color"), colorValue: $("#colorValue"), colorArea: $("#colorArea"),
  size: $("#size"), sizeLabel: $("#sizeLabel"), sizeValue: $("#sizeValue"), opacity: $("#opacity"),
  opacityValue: $("#opacityValue"), toolLabel: $("#toolLabel"),
  rightClickClear: $("#rightClickClear"), save: $("#save"),
  captureInterval: $("#captureInterval"), sequence: $("#sequence"),
  sequenceLabel: $("#sequenceLabel"), sequenceCount: $("#sequenceCount"), clear: $("#clear")
};

let tab = null;
let state = { enabled: false, mode: "draw" };
let tool = {
  tool: "pen", color: "#ff4d6d", penSize: 6, eraserSize: 28, textSize: 28,
  opacity: 1, rightClickClear: true
};
let sequenceRunning = false;
let sequenceFrames = [];
let sequenceTimer = null;
let sequenceCapturing = false;
const MAX_SEQUENCE_FRAMES = 10;
const MAX_SEQUENCE_BYTES = 200 * 1024 * 1024;

function renderSequence() {
  ui.sequence.classList.toggle("running", sequenceRunning);
  ui.sequenceLabel.textContent = t(sequenceRunning ? "stopSequence" : "startSequence");
  ui.sequenceCount.value = t("captureCount", String(sequenceFrames.length));
  ui.captureInterval.disabled = sequenceRunning;
}

async function captureSequenceFrame() {
  if (!sequenceRunning || sequenceCapturing || !tab?.windowId) return;
  sequenceCapturing = true;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg",
      quality: 90
    });
    const bytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
    const totalBytes = sequenceFrames.reduce((total, frame) => total + frame.bytes.length, 0);
    if (sequenceFrames.length >= MAX_SEQUENCE_FRAMES || totalBytes + bytes.length > MAX_SEQUENCE_BYTES) {
      await stopSequenceCapture(t("sequenceLimitReached"));
      return;
    }
    const index = String(sequenceFrames.length + 1).padStart(4, "0");
    sequenceFrames.push({ name: `capture-${index}.jpg`, bytes, date: new Date() });
    renderSequence();
    if (sequenceFrames.length >= MAX_SEQUENCE_FRAMES) {
      await stopSequenceCapture(t("sequenceLimitReached"));
    }
  } catch {
    await stopSequenceCapture(t("sequenceInterrupted"));
  } finally {
    sequenceCapturing = false;
  }
}

async function startSequenceCapture() {
  sequenceFrames = [];
  sequenceRunning = true;
  renderSequence();
  await captureSequenceFrame();
  if (!sequenceRunning) return;
  sequenceTimer = setInterval(captureSequenceFrame, Number(ui.captureInterval.value));
  ui.status.textContent = t("sequenceCapturing");
}

async function stopSequenceCapture(statusMessage = t("sequenceSaved")) {
  clearInterval(sequenceTimer);
  sequenceTimer = null;
  sequenceRunning = false;
  renderSequence();
  if (!sequenceFrames.length) {
    ui.status.textContent = t("noCaptures");
    return;
  }
  ui.sequence.disabled = true;
  try {
    const zip = window.createZipBlob(sequenceFrames);
    const url = URL.createObjectURL(zip);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await chrome.downloads.download({
      url,
      filename: `annotap/annotap-sequence-${stamp}.zip`,
      saveAs: false
    });
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    ui.status.textContent = statusMessage;
    sequenceFrames = [];
    renderSequence();
  } catch {
    ui.status.textContent = t("sequenceSaveFailed");
  } finally {
    ui.sequence.disabled = false;
  }
}

function isBlocked(url = "") {
  return /^(chrome|edge|about|devtools):/.test(url) || url.startsWith("https://chromewebstore.google.com/");
}

async function activeTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
    windowType: "normal"
  });
  [tab] = tabs;
  return tab;
}

function background(message) {
  return chrome.runtime.sendMessage({ ...message, tabId: tab?.id });
}

async function page(message, inject = true) {
  if (!tab?.id || isBlocked(tab.url)) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    if (!inject) return null;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch {
      showBlocked(true);
      return null;
    }
  }
}

function showBlocked(blocked) {
  ui.blocked.hidden = !blocked;
  ui.workspace.hidden = blocked;
  ui.enabled.disabled = blocked;
}

function render() {
  ui.enabled.checked = state.enabled;
  ui.workspace.classList.toggle("disabled", !state.enabled);
  $$(".tool").forEach((button) => {
    const selected = state.mode === "navigate" ? button.dataset.action === "navigate" : button.dataset.action === tool.tool;
    button.classList.toggle("active", selected);
  });
  ui.toolLabel.textContent = t(state.mode === "navigate" ? "pageControl" : tool.tool === "pen" ? "pen" : tool.tool === "eraser" ? "eraser" : "textTool");
  ui.colorArea.style.display = tool.tool === "eraser" ? "none" : "block";
  ui.color.value = tool.color;
  ui.colorValue.value = tool.color.toUpperCase();
  const activeSize = tool.tool === "eraser" ? tool.eraserSize : tool.tool === "text" ? tool.textSize : tool.penSize;
  ui.sizeLabel.textContent = t(tool.tool === "text" ? "textSize" : "thickness");
  ui.size.min = tool.tool === "text" ? "12" : "2";
  ui.size.value = activeSize;
  ui.sizeValue.value = `${activeSize} px`;
  ui.opacity.value = Math.round(tool.opacity * 100);
  ui.opacityValue.value = `${Math.round(tool.opacity * 100)}%`;
  ui.rightClickClear.checked = tool.rightClickClear !== false;
  $$(".swatch").forEach((button) => button.classList.toggle("active", button.dataset.color.toLowerCase() === tool.color.toLowerCase()));
  ui.statusDot.classList.toggle("on", state.enabled);
  ui.status.textContent = t(!state.enabled ? "canvasOffForTab" : state.mode === "draw" ? "readyToDraw" : "controllingPage");
}

async function setState(patch) {
  state = { ...state, ...patch };
  await background({ type: "SET_TAB_STATE", patch });
  await page({ type: "APPLY_STATE", state });
  render();
}

async function setTool(patch) {
  tool = { ...tool, ...patch };
  await background({ type: "SET_TOOL", tool });
  await page({ type: "APPLY_TOOL", tool }, false);
  render();
}

ui.enabled.addEventListener("change", async () => {
  await setState({ enabled: ui.enabled.checked });
});

$$(".tool").forEach((button) => button.addEventListener("click", async () => {
  const action = button.dataset.action;
  if (action === "navigate") await setState({ mode: "navigate" });
  else {
    await setTool({ tool: action });
    await setState({ mode: "draw" });
  }
}));
$$(".swatch").forEach((button) => button.addEventListener("click", () => setTool({ color: button.dataset.color })));
ui.color.addEventListener("input", () => setTool({ color: ui.color.value }));
ui.size.addEventListener("input", () => {
  const sizeKey = tool.tool === "eraser" ? "eraserSize" : tool.tool === "text" ? "textSize" : "penSize";
  setTool({ [sizeKey]: Number(ui.size.value) });
});
ui.opacity.addEventListener("input", () => setTool({ opacity: Number(ui.opacity.value) / 100 }));
ui.rightClickClear.addEventListener("change", () => setTool({ rightClickClear: ui.rightClickClear.checked }));
ui.save.addEventListener("click", async () => {
  if (!tab?.windowId) return;
  ui.save.disabled = true;
  const previousStatus = ui.status.textContent;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await chrome.downloads.download({
      url: dataUrl,
      filename: `annotap/annotap-${stamp}.png`,
      saveAs: false
    });
    ui.statusDot.classList.add("saved");
    ui.status.textContent = t("captureSaved");
  } catch {
    ui.status.textContent = t("captureFailed");
  } finally {
    ui.save.disabled = false;
    setTimeout(() => {
      ui.statusDot.classList.remove("saved");
      ui.status.textContent = previousStatus;
    }, 2200);
  }
});
ui.sequence.addEventListener("click", async () => {
  if (sequenceRunning) await stopSequenceCapture();
  else await startSequenceCapture();
});
ui.clear.addEventListener("click", async () => {
  await page({ type: "CLEAR" });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SET_TAB_STATE" && message.patch && tab?.id) {
    state = { ...state, ...message.patch };
    render();
  }
});

chrome.tabs.onActivated.addListener(async () => {
  if (sequenceRunning) await stopSequenceCapture(t("tabChanged"));
  initialize();
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === tab?.id && changeInfo.status === "complete") initialize();
});

async function initialize() {
  await activeTab();
  const blocked = !tab || isBlocked(tab.url);
  showBlocked(blocked);
  if (blocked) return;
  ui.pageTitle.textContent = tab.title || t("currentPage");
  const response = await background({ type: "GET_TAB_STATE" });
  if (response?.ok) {
    state = response.state;
    tool = response.tool;
  }
  render();
  if (state.enabled) await page({ type: "APPLY_STATE", state });
}

localizeDocument();
initialize();
