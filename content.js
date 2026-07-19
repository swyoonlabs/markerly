(() => {
  const CANVAS_ID = "page-canvas-overlay-extension";
  const LEGACY_BADGE_ID = "page-canvas-overlay-badge";
  document.getElementById(CANVAS_ID)?.remove();
  document.getElementById(LEGACY_BADGE_ID)?.remove();

  let canvas;
  let context;
  let drawing = false;
  let currentStroke = null;
  let strokes = [];
  let state = { enabled: false, mode: "draw" };
  let tool = {
    tool: "pen", color: "#ff4d6d", penSize: 6, eraserSize: 28,
    opacity: 1, rightClickClear: true
  };
  let recordingStream = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordingStartedAt = null;

  function notifyRecording(recording) {
    chrome.runtime.sendMessage({
      type: "RECORDING_CHANGED",
      recording,
      startedAt: recording ? recordingStartedAt : null
    }).catch(() => {});
  }

  function recordingMimeType() {
    return ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
      .find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
  }

  async function finishRecording() {
    const blob = new Blob(recordedChunks, { type: mediaRecorder?.mimeType || "video/webm" });
    if (blob.size) {
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const link = document.createElement("a");
      link.href = url;
      link.download = `page-canvas-recording-${stamp}.webm`;
      link.style.display = "none";
      document.documentElement.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
    recordingStream?.getTracks().forEach((track) => track.stop());
    recordingStream = null;
    mediaRecorder = null;
    recordedChunks = [];
    recordingStartedAt = null;
    notifyRecording(false);
  }

  function stopPageRecording() {
    if (mediaRecorder?.state === "recording") mediaRecorder.stop();
  }

  function createRecordingButton() {
    document.getElementById("page-canvas-record-start")?.remove();
    const button = document.createElement("button");
    button.id = "page-canvas-record-start";
    button.type = "button";
    button.textContent = "● 녹화 시작";
    Object.assign(button.style, {
      position: "fixed", top: "20px", left: "50%", transform: "translateX(-50%)",
      zIndex: "2147483647", padding: "12px 20px", border: "0", borderRadius: "999px",
      color: "#fff", background: "#df3652", boxShadow: "0 8px 28px rgba(0,0,0,.28)",
      font: "700 14px system-ui, sans-serif", cursor: "pointer"
    });
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "화면 선택 중…";
      try {
        recordingStream = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: "browser", frameRate: { ideal: 30, max: 30 } },
          audio: true,
          preferCurrentTab: true,
          surfaceSwitching: "exclude",
          systemAudio: "include"
        });
        const displaySurface = recordingStream.getVideoTracks()[0]?.getSettings().displaySurface;
        if (displaySurface && displaySurface !== "browser") {
          recordingStream.getTracks().forEach((track) => track.stop());
          recordingStream = null;
          throw new Error("Chrome 탭을 선택하세요.");
        }
        button.remove();
        const mimeType = recordingMimeType();
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(
          recordingStream,
          mimeType ? { mimeType, videoBitsPerSecond: 5_000_000 } : undefined
        );
        mediaRecorder.addEventListener("dataavailable", (event) => {
          if (event.data.size) recordedChunks.push(event.data);
        });
        mediaRecorder.addEventListener("stop", finishRecording, { once: true });
        recordingStream.getVideoTracks()[0]?.addEventListener("ended", stopPageRecording);
        recordingStartedAt = Date.now();
        mediaRecorder.start(1000);
        notifyRecording(true);
      } catch (error) {
        button.textContent = error?.name === "NotAllowedError" ? "화면 선택이 취소됐어요" : error.message;
        setTimeout(() => button.remove(), 1800);
      }
    }, { once: true });
    document.documentElement.appendChild(button);
  }

  const PEN_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <path d="M5 25.5l1.7-6.4L21.8 4a3 3 0 014.2 0l2 2a3 3 0 010 4.2L12.9 25.3 6.5 27z" fill="#fff" stroke="#171923" stroke-width="2" stroke-linejoin="round"/>
      <path d="M19.7 6.1l6.2 6.2M6.7 19.1l6.2 6.2" fill="none" stroke="#171923" stroke-width="2"/>
      <path d="M5 25.5L3.5 29 7 27z" fill="#171923"/>
    </svg>`)}") 4 28, crosshair`;

  const ERASER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <path d="M5.2 20.1L17.4 5.8a3 3 0 014.2-.3l5 4.3a3 3 0 01.3 4.2L14.7 28.2H8.6l-3.1-2.7a3.8 3.8 0 01-.3-5.4z" fill="#ffb6c3" stroke="#171923" stroke-width="2" stroke-linejoin="round"/>
      <path d="M10.3 14.2l9.6 8.2-5 5.8H8.6l-3.1-2.7a3.8 3.8 0 01-.3-5.4z" fill="#fff" stroke="#171923" stroke-width="2" stroke-linejoin="round"/>
    </svg>`)}") 8 27, cell`;

  function send(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(response);
      });
    });
  }

  function resizeCanvas() {
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    render();
  }

  function renderStroke(stroke) {
    if (!context || stroke.points.length < 1) return;
    context.save();
    context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
    context.globalAlpha = stroke.opacity;
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    context.lineWidth = stroke.size;
    context.lineCap = "round";
    context.lineJoin = "round";

    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      context.beginPath();
      context.arc(point.x, point.y, stroke.size / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.beginPath();
      context.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let index = 1; index < stroke.points.length; index += 1) {
        const previous = stroke.points[index - 1];
        const point = stroke.points[index];
        const midX = (previous.x + point.x) / 2;
        const midY = (previous.y + point.y) / 2;
        context.quadraticCurveTo(previous.x, previous.y, midX, midY);
      }
      context.stroke();
    }
    context.restore();
  }

  function render() {
    if (!context || !canvas) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach(renderStroke);
    if (currentStroke) renderStroke(currentStroke);
  }

  function createOverlay() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.id = CANVAS_ID;
    Object.assign(canvas.style, {
      position: "fixed", inset: "0", zIndex: "2147483646", cursor: "crosshair",
      touchAction: "none", userSelect: "none"
    });
    canvas.addEventListener("pointerdown", startDrawing);
    canvas.addEventListener("pointermove", continueDrawing);
    canvas.addEventListener("pointerup", finishDrawing);
    canvas.addEventListener("pointercancel", cancelDrawing);
    canvas.addEventListener("contextmenu", handleRightClick);

    document.documentElement.append(canvas);
    window.addEventListener("resize", resizeCanvas);
    applyMode();
    resizeCanvas();
  }

  function removeOverlay() {
    window.removeEventListener("resize", resizeCanvas);
    canvas?.remove();
    canvas = null;
    context = null;
    drawing = false;
    currentStroke = null;
  }

  function applyMode() {
    if (!canvas) return;
    const canDraw = state.mode === "draw";
    canvas.style.pointerEvents = canDraw ? "auto" : "none";
    canvas.style.cursor = tool.tool === "eraser" ? ERASER_CURSOR : PEN_CURSOR;
  }

  function applyState(nextState) {
    state = { ...state, ...nextState };
    if (state.enabled) createOverlay();
    else removeOverlay();
    applyMode();
  }

  function point(event) {
    return { x: event.clientX, y: event.clientY };
  }

  function startDrawing(event) {
    if (event.button !== 0 || state.mode !== "draw") return;
    drawing = true;
    currentStroke = {
      tool: tool.tool,
      color: tool.color,
      size: tool.tool === "eraser" ? tool.eraserSize : tool.penSize,
      opacity: tool.tool === "eraser" ? 1 : tool.opacity,
      points: [point(event)]
    };
    canvas.setPointerCapture(event.pointerId);
    render();
    event.preventDefault();
  }

  function continueDrawing(event) {
    if (!drawing || !currentStroke) return;
    const events = event.getCoalescedEvents?.() ?? [event];
    events.forEach((item) => currentStroke.points.push(point(item)));
    render();
    event.preventDefault();
  }

  async function finishDrawing(event) {
    if (!drawing || !currentStroke) return;
    drawing = false;
    strokes.push(currentStroke);
    currentStroke = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    render();
    await saveDrawing();
  }

  function cancelDrawing() {
    drawing = false;
    currentStroke = null;
    render();
  }

  function saveDrawing() {
    return send({ type: "SAVE_DRAWING", strokes });
  }

  async function clear() {
    if (!strokes.length) return;
    strokes = [];
    render();
    await saveDrawing();
  }

  function handleRightClick(event) {
    if (state.mode !== "draw" || !tool.rightClickClear) return;
    event.preventDefault();
    event.stopPropagation();
    clear();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "APPLY_STATE") applyState(message.state);
    if (message.type === "APPLY_TOOL") {
      tool = { ...tool, ...message.tool };
      applyMode();
    }
    if (message.type === "CLEAR") clear();
    if (message.type === "ARM_PAGE_RECORDING") createRecordingButton();
    if (message.type === "STOP_PAGE_RECORDING") stopPageRecording();
    if (message.type === "GET_PAGE_RECORDING_STATUS") {
      sendResponse({
        recording: mediaRecorder?.state === "recording",
        startedAt: recordingStartedAt
      });
    }
  });

  send({ type: "GET_CONTEXT" }).then((response) => {
    if (!response?.ok) return;
    state = response.state;
    tool = response.tool;
    strokes = response.strokes;
    if (state.enabled) createOverlay();
  });
})();
