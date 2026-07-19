const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const ui = {
  enabled: $("#enabled"), workspace: $("#workspace"), blocked: $("#blocked"),
  pageTitle: $("#pageTitle"), status: $("#status"), statusDot: $("#statusDot"),
  color: $("#color"), colorValue: $("#colorValue"), colorArea: $("#colorArea"),
  size: $("#size"), sizeValue: $("#sizeValue"), opacity: $("#opacity"),
  opacityValue: $("#opacityValue"), toolLabel: $("#toolLabel"),
  rightClickClear: $("#rightClickClear"), save: $("#save"),
  captureInterval: $("#captureInterval"), sequence: $("#sequence"),
  sequenceLabel: $("#sequenceLabel"), sequenceCount: $("#sequenceCount"), clear: $("#clear")
};

let tab = null;
let state = { enabled: false, mode: "draw" };
let tool = {
  tool: "pen", color: "#ff4d6d", penSize: 6, eraserSize: 28,
  opacity: 1, rightClickClear: true
};
let sequenceRunning = false;
let sequenceFrames = [];
let sequenceTimer = null;
let sequenceCapturing = false;
const MAX_SEQUENCE_FRAMES = 300;
const MAX_SEQUENCE_BYTES = 200 * 1024 * 1024;

function renderSequence() {
  ui.sequence.classList.toggle("running", sequenceRunning);
  ui.sequenceLabel.textContent = sequenceRunning ? "연속 캡처 종료" : "연속 캡처 시작";
  ui.sequenceCount.value = `${sequenceFrames.length}장`;
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
      await stopSequenceCapture("안전 제한에 도달해 자동으로 저장했어요");
      return;
    }
    const index = String(sequenceFrames.length + 1).padStart(4, "0");
    sequenceFrames.push({ name: `capture-${index}.jpg`, bytes, date: new Date() });
    renderSequence();
  } catch {
    await stopSequenceCapture("캡처가 중단되어 지금까지의 이미지를 저장했어요");
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
  ui.status.textContent = "연속 캡처 중 · 사이드 패널을 열어두세요";
}

async function stopSequenceCapture(statusMessage = "연속 캡처를 저장했어요") {
  clearInterval(sequenceTimer);
  sequenceTimer = null;
  sequenceRunning = false;
  renderSequence();
  if (!sequenceFrames.length) {
    ui.status.textContent = "저장할 캡처 이미지가 없어요";
    return;
  }
  ui.sequence.disabled = true;
  try {
    const zip = window.createZipBlob(sequenceFrames);
    const url = URL.createObjectURL(zip);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await chrome.downloads.download({
      url,
      filename: `page-canvas/page-canvas-sequence-${stamp}.zip`,
      saveAs: false
    });
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    ui.status.textContent = statusMessage;
    sequenceFrames = [];
    renderSequence();
  } catch {
    ui.status.textContent = "연속 캡처 ZIP을 저장하지 못했어요";
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
  if (sequenceRunning) await stopSequenceCapture("탭이 변경되어 캡처를 종료했어요");
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
  ui.pageTitle.textContent = tab.title || "현재 페이지";
  const response = await background({ type: "GET_TAB_STATE" });
  if (response?.ok) {
    state = response.state;
    tool = response.tool;
  }
  render();
  if (state.enabled) await page({ type: "APPLY_STATE", state });
}

initialize();
