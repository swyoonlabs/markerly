(() => {
  const CANVAS_ID = "annotap-canvas-overlay";
  const LEGACY_CANVAS_ID = "page-canvas-overlay-extension";
  const LEGACY_BADGE_ID = "page-canvas-overlay-badge";
  document.getElementById(LEGACY_CANVAS_ID)?.remove();
  document.getElementById(CANVAS_ID)?.remove();
  document.getElementById(LEGACY_BADGE_ID)?.remove();

  let canvas;
  let context;
  let drawing = false;
  let currentStroke = null;
  let movingText = null;
  let strokes = [];
  let state = { enabled: false, mode: "draw" };
  let tool = {
    tool: "pen", color: "#ff4d6d", penSize: 6, eraserSize: 28, textSize: 28,
    opacity: 1, rightClickClear: true
  };
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
    if (!context) return;
    context.save();
    if (stroke.kind === "text") {
      context.globalAlpha = stroke.opacity;
      context.fillStyle = stroke.color;
      context.font = `600 ${stroke.size}px system-ui, sans-serif`;
      context.textBaseline = "top";
      stroke.text.split("\n").forEach((line, index) => {
        context.fillText(line, stroke.x, stroke.y + index * stroke.size * 1.25);
      });
      context.restore();
      return;
    }
    if (!stroke.points?.length) {
      context.restore();
      return;
    }
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
    canvas.style.cursor = tool.tool === "eraser" ? ERASER_CURSOR : tool.tool === "text" ? "text" : PEN_CURSOR;
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

  function textBounds(item) {
    if (!context || item.kind !== "text") return null;
    context.save();
    context.font = `600 ${item.size}px system-ui, sans-serif`;
    const lines = item.text.split("\n");
    const width = Math.max(...lines.map((line) => context.measureText(line).width), item.size);
    context.restore();
    return { x: item.x, y: item.y, width, height: lines.length * item.size * 1.25 };
  }

  function findTextAt(position) {
    for (let index = strokes.length - 1; index >= 0; index -= 1) {
      const item = strokes[index];
      const bounds = textBounds(item);
      if (!bounds) continue;
      const padding = 6;
      if (
        position.x >= bounds.x - padding && position.x <= bounds.x + bounds.width + padding &&
        position.y >= bounds.y - padding && position.y <= bounds.y + bounds.height + padding
      ) return item;
    }
    return null;
  }

  function startDrawing(event) {
    if (event.button !== 0 || state.mode !== "draw") return;
    if (tool.tool === "text") {
      const position = point(event);
      const target = findTextAt(position);
      if (target) {
        movingText = {
          item: target,
          offsetX: position.x - target.x,
          offsetY: position.y - target.y,
          originalX: target.x,
          originalY: target.y
        };
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = "grabbing";
      } else {
        createTextEditor(position);
      }
      event.preventDefault();
      return;
    }
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
    if (movingText) {
      const position = point(event);
      movingText.item.x = position.x - movingText.offsetX;
      movingText.item.y = position.y - movingText.offsetY;
      render();
      event.preventDefault();
      return;
    }
    if (!drawing && tool.tool === "text") {
      canvas.style.cursor = findTextAt(point(event)) ? "grab" : "text";
      return;
    }
    if (!drawing || !currentStroke) return;
    const events = event.getCoalescedEvents?.() ?? [event];
    events.forEach((item) => currentStroke.points.push(point(item)));
    render();
    event.preventDefault();
  }

  async function finishDrawing(event) {
    if (movingText) {
      movingText = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      canvas.style.cursor = "text";
      await saveDrawing();
      return;
    }
    if (!drawing || !currentStroke) return;
    drawing = false;
    strokes.push(currentStroke);
    currentStroke = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    render();
    await saveDrawing();
  }

  function cancelDrawing() {
    if (movingText) {
      movingText.item.x = movingText.originalX;
      movingText.item.y = movingText.originalY;
      movingText = null;
      render();
    }
    drawing = false;
    currentStroke = null;
    render();
  }

  function saveDrawing() {
    return send({ type: "SAVE_DRAWING", strokes });
  }

  function createTextEditor(position) {
    document.getElementById("annotap-text-editor")?.remove();
    document.getElementById("page-canvas-text-editor")?.remove();
    const editor = document.createElement("textarea");
    editor.id = "annotap-text-editor";
    editor.rows = 1;
    editor.placeholder = chrome.i18n.getMessage("textPlaceholder") || "Type your text";
    Object.assign(editor.style, {
      position: "fixed", left: `${position.x}px`, top: `${position.y}px`,
      zIndex: "2147483647", minWidth: "180px", maxWidth: "420px", padding: "6px 8px",
      border: `1px solid ${tool.color}`, borderRadius: "6px", outline: "none",
      color: tool.color, background: "rgba(255,255,255,.94)", resize: "both",
      font: `600 ${tool.textSize}px system-ui, sans-serif`, lineHeight: "1.25",
      boxShadow: "0 5px 20px rgba(0,0,0,.18)"
    });
    let finished = false;
    const finish = async (save) => {
      if (finished) return;
      finished = true;
      const text = editor.value.trim();
      editor.remove();
      if (!save || !text) return;
      strokes.push({
        kind: "text", text, x: position.x, y: position.y,
        color: tool.color, size: tool.textSize, opacity: tool.opacity
      });
      render();
      await saveDrawing();
    };
    editor.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      } else if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        finish(true);
      }
    });
    editor.addEventListener("blur", () => finish(true));
    document.documentElement.appendChild(editor);
    editor.focus();
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
  });

  send({ type: "GET_CONTEXT" }).then((response) => {
    if (!response?.ok) return;
    state = response.state;
    tool = response.tool;
    strokes = response.strokes;
    if (state.enabled) createOverlay();
  });
})();
