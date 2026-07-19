const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const ui = {
  enabled: $("#enabled"), workspace: $("#workspace"), blocked: $("#blocked"),
  pageTitle: $("#pageTitle"), status: $("#status"), statusDot: $("#statusDot"),
  color: $("#color"), colorValue: $("#colorValue"), colorArea: $("#colorArea"),
  size: $("#size"), sizeValue: $("#sizeValue"), opacity: $("#opacity"),
  opacityValue: $("#opacityValue"), toolLabel: $("#toolLabel"),
  rightClickClear: $("#rightClickClear"), record: $("#record"),
  recordLabel: $("#recordLabel"), recordTime: $("#recordTime"), save: $("#save"), clear: $("#clear")
};

let tab = null;
let state = { enabled: false, mode: "draw" };
let tool = {
  tool: "pen", color: "#ff4d6d", penSize: 6, eraserSize: 28,
  opacity: 1, rightClickClear: true
};
let recording = false;
let recordingStartedAt = null;
let recordingTimer = null;

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function renderRecording() {
  ui.record.classList.toggle("recording", recording);
  ui.recordLabel.textContent = recording ? "영상 녹화 종료" : "영상 녹화 준비";
  ui.recordTime.hidden = !recording;
  clearInterval(recordingTimer);
  recordingTimer = null;
  if (recording && recordingStartedAt) {
    const tick = () => { ui.recordTime.textContent = formatDuration(Date.now() - recordingStartedAt); };
    tick();
    recordingTimer = setInterval(tick, 1000);
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
  ui.toolLabel.textContent = state.mode === "navigate" ? "페이지 조작" : tool.tool === "pen" ? "펜" : "지우개";
  ui.colorArea.style.display = tool.tool === "pen" ? "block" : "none";
  ui.color.value = tool.color;
  ui.colorValue.value = tool.color.toUpperCase();
  const activeSize = tool.tool === "eraser" ? tool.eraserSize : tool.penSize;
  ui.size.value = activeSize;
  ui.sizeValue.value = `${activeSize} px`;
  ui.opacity.value = Math.round(tool.opacity * 100);
  ui.opacityValue.value = `${Math.round(tool.opacity * 100)}%`;
  ui.rightClickClear.checked = tool.rightClickClear !== false;
  $$(".swatch").forEach((button) => button.classList.toggle("active", button.dataset.color.toLowerCase() === tool.color.toLowerCase()));
  ui.statusDot.classList.toggle("on", state.enabled);
  ui.status.textContent = !state.enabled ? "이 탭의 캔버스 꺼짐" : state.mode === "draw" ? "그리기 준비됨" : "페이지 조작 중";
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
  const sizeKey = tool.tool === "eraser" ? "eraserSize" : "penSize";
  setTool({ [sizeKey]: Number(ui.size.value) });
});
ui.opacity.addEventListener("input", () => setTool({ opacity: Number(ui.opacity.value) / 100 }));
ui.rightClickClear.addEventListener("change", () => setTool({ rightClickClear: ui.rightClickClear.checked }));
ui.record.addEventListener("click", async () => {
  ui.record.disabled = true;
  const previousStatus = ui.status.textContent;
  try {
    if (recording) {
      await page({ type: "STOP_PAGE_RECORDING" });
    } else {
      await page({ type: "ARM_PAGE_RECORDING" });
      ui.status.textContent = "YouTube 화면의 녹화 시작 버튼을 누르세요";
    }
  } catch (error) {
    ui.status.textContent = error?.message || "녹화를 준비하지 못했어요";
  } finally {
    ui.record.disabled = false;
    if (!recording) setTimeout(() => { ui.status.textContent = previousStatus; }, 2200);
  }
});
ui.save.addEventListener("click", async () => {
  if (!tab?.windowId) return;
  ui.save.disabled = true;
  const previousStatus = ui.status.textContent;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await chrome.downloads.download({
      url: dataUrl,
      filename: `page-canvas/page-canvas-${stamp}.png`,
      saveAs: false
    });
    ui.statusDot.classList.add("saved");
    ui.status.textContent = "배경과 그림을 함께 저장했어요";
  } catch {
    ui.status.textContent = "화면을 저장하지 못했어요";
  } finally {
    ui.save.disabled = false;
    setTimeout(() => {
      ui.statusDot.classList.remove("saved");
      ui.status.textContent = previousStatus;
    }, 2200);
  }
});
ui.clear.addEventListener("click", async () => {
  await page({ type: "CLEAR" });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "RECORDING_CHANGED") {
    recording = message.recording;
    recordingStartedAt = message.startedAt ?? null;
    renderRecording();
    ui.status.textContent = recording ? "현재 탭을 녹화하고 있어요" : "녹화를 저장했어요";
  }
  if (message.type === "SET_TAB_STATE" && message.patch && tab?.id) {
    state = { ...state, ...message.patch };
    render();
  }
});

chrome.tabs.onActivated.addListener(() => initialize());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === tab?.id && changeInfo.status === "complete") initialize();
});

async function initialize() {
  await activeTab();
  const blocked = !tab || isBlocked(tab.url);
  showBlocked(blocked);
  if (blocked) return;
  ui.pageTitle.textContent = tab.title || "현재 페이지";
  const response = await background({ type: "GET_TAB_STATE" });
  if (response?.ok) {
    state = response.state;
    tool = response.tool;
  }
  render();
  if (state.enabled) await page({ type: "APPLY_STATE", state });
  const recordingStatus = await page({ type: "GET_PAGE_RECORDING_STATUS" }, false);
  recording = Boolean(recordingStatus?.recording);
  recordingStartedAt = recordingStatus?.startedAt ?? null;
  renderRecording();
}

initialize();
