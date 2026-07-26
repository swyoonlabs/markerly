#!/usr/bin/env python3
"""Markerly 스토어/프로모 이미지 생성기.

헤드리스 Chrome으로 실제 사이드 패널을 렌더링한 뒤,
브라우저 목업(웹페이지 + 주석 오버레이 + 도킹된 패널)과 카피를 합성합니다.

산출물:
  screenshots/markerly-panel.png        — 세로 패널 스크린샷(블로그/README용)
  screenshots/markerly-1-draw.png ..    — 1280x800 스토어 스크린샷 4종
  store-assets/store-icon-128.png       — 스토어 아이콘
  store-assets/promo-tile-440x280.png   — 프로모션 타일

필요: Google Chrome, Pillow(PIL).
사용법: python tools/make_store_assets.py
Chrome 경로 지정: set CHROME=C:\\path\\to\\chrome.exe && python tools/make_store_assets.py

메모: 헤드리스 Chrome은 창 폭 ~516px 미만에서 innerWidth를 클램프하므로
패널은 넓은 창에서 CSS로 폭을 360px 고정하고 마젠타 센티넬 배경으로
자동 크롭한다. 이미지 폭 = 창폭 x dpr 로 결정적이다.
"""
import base64
import json
import os
import shutil
import subprocess
import tempfile

from PIL import Image, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "screenshots")
STORE = os.path.join(ROOT, "store-assets")
CHROME = os.environ.get(
    "CHROME", r"C:\Program Files\Google\Chrome\Application\chrome.exe"
)
TMP = tempfile.mkdtemp(prefix="markerly-assets-")

BRAND = "#6657e8"
PINK = "#ff4d6d"
PANEL_CSS_W = 360      # 패널 CSS 폭(고정)
PANEL_SCALE = 2        # dpr
SENTINEL = (255, 0, 255)

# ---------------------------------------------------------------------------
# Chrome helpers
# ---------------------------------------------------------------------------


def chrome_shot(html_path, out_path, w, h, scale=1, transparent=False):
    args = [
        CHROME,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--allow-file-access-from-files",
        f"--force-device-scale-factor={scale}",
        f"--window-size={w},{h}",
        f"--screenshot={out_path}",
        "--virtual-time-budget=2000",
    ]
    if transparent:
        args.append("--default-background-color=00000000")
    args.append(f"file://{html_path}")
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def data_uri(path):
    b = base64.b64encode(open(path, "rb").read()).decode()
    return "data:image/png;base64," + b


_ICON_URI = None


def icon_uri():
    global _ICON_URI
    if _ICON_URI is None:
        _ICON_URI = data_uri(os.path.join(ROOT, "icons", "icon128.png"))
    return _ICON_URI


# ---------------------------------------------------------------------------
# 1) 실제 사이드 패널 렌더 (chrome API 스텁 + 폭 고정 + 센티넬 배경)
# ---------------------------------------------------------------------------


def build_panel_html(lang="en", ui_lang="en-US"):
    html = open(os.path.join(ROOT, "sidepanel.html"), encoding="utf-8").read()
    html = html.replace('href="sidepanel.css"', f'href="file://{ROOT}/sidepanel.css"')
    msgs = json.load(
        open(os.path.join(ROOT, "_locales", lang, "messages.json"), encoding="utf-8")
    )
    flat = {k: v["message"] for k, v in msgs.items()}

    tool = {
        "tool": "pen", "color": PINK, "penSize": 6, "eraserSize": 28,
        "textSize": 28, "opacity": 1, "rightClickClear": True,
    }
    state = {"enabled": True, "mode": "draw"}

    stub = (
        "<style>\n"
        f"  html:root{{background:rgb{SENTINEL} !important;}}\n"
        f"  body{{width:{PANEL_CSS_W}px;height:-moz-fit-content;height:fit-content;"
        "margin:0;background:#f5f6f8;}\n"
        "  .app{min-height:auto;padding-bottom:20px;}\n"
        f"  footer{{position:static;width:{PANEL_CSS_W}px;margin-top:10px;"
        "background:rgba(255,255,255,.94);}\n"
        "</style>\n"
        "<script>\n"
        f"const _msgs={json.dumps(flat, ensure_ascii=False)};\n"
        f"const _state={json.dumps(state)};\n"
        f"const _tool={json.dumps(tool)};\n"
        "const _tab={id:1,windowId:1,title:'Getting started \\u2014 Example Docs',"
        "url:'https://example.com/docs/getting-started'};\n"
        "const _noop=()=>{};const _listener={addListener:_noop};\n"
        "window.chrome={"
        f"i18n:{{getUILanguage:()=>'{ui_lang}',getMessage:(k,s)=>{{let m=_msgs[k];"
        "if(m===undefined)return '';if(s!==undefined){(Array.isArray(s)?s:[s]).forEach((x,i)=>{m=m.replace('$'+(i+1),x).replace('$COUNT$',x);});}return m;}},"
        "tabs:{query:()=>Promise.resolve([_tab]),sendMessage:()=>Promise.resolve({ok:true}),"
        "captureVisibleTab:()=>Promise.resolve(''),onActivated:_listener,onUpdated:_listener},"
        "runtime:{sendMessage:(m)=>Promise.resolve(m&&m.type==='GET_TAB_STATE'?{ok:true,state:_state,tool:_tool}:{ok:true}),onMessage:_listener},"
        "scripting:{executeScript:()=>Promise.resolve([])},"
        "downloads:{download:()=>Promise.resolve(1)}};\n"
        "</script>\n"
    )
    inject = '<script src="zip.js"></script><script src="sidepanel.js"></script>'
    replacement = (
        stub
        + f'<script src="file://{ROOT}/zip.js"></script>'
        + f'<script src="file://{ROOT}/sidepanel.js"></script>'
    )
    html = html.replace(inject, replacement)
    p = os.path.join(TMP, "panel.html")
    open(p, "w", encoding="utf-8").write(html)
    return p


def render_panel():
    """폭 고정 패널을 렌더 후 센티넬 배경으로 자동 크롭해 PNG 경로 반환."""
    panel_html = build_panel_html()
    big = os.path.join(TMP, "panel-raw.png")
    # 넓은 창(클램프 회피) + 넉넉한 높이. 이미지 폭 = 창폭 x dpr.
    chrome_shot(panel_html, big, 760, 1400, scale=PANEL_SCALE)

    img = Image.open(big).convert("RGB")
    panel_w = PANEL_CSS_W * PANEL_SCALE  # 720: 폭은 결정적
    strip = img.crop((0, 0, panel_w, img.height))
    diff = ImageChops.difference(strip, Image.new("RGB", strip.size, SENTINEL))
    bbox = diff.getbbox()  # (0,0,panel_w,contentH)
    content_h = bbox[3] - 1 if bbox else img.height
    out = os.path.join(SHOTS, "markerly-panel.png")
    strip.crop((0, 0, panel_w, content_h)).save(out, "PNG")
    print("wrote", os.path.relpath(out, ROOT))
    return out


# ---------------------------------------------------------------------------
# 2) 목업 웹페이지 (중립적인 샘플 문서 — 실제 브랜드 사칭 아님)
# ---------------------------------------------------------------------------

SAMPLE_PAGE = """
  <div class="doc">
    <div class="eyebrow">DOCUMENTATION</div>
    <h1 class="doc-title">Getting started in five minutes</h1>
    <p class="lead">A short walkthrough of the core concepts, the setup flow,
      and the first thing to try once everything is installed.</p>
    <div class="hero-img"></div>
    <h2>1. Install the toolkit</h2>
    <p>Add the package to your project and import the client. Every example on
      this page assumes the default configuration and a modern browser.</p>
    <p>Once the dependencies are ready, open the dashboard and connect your first
      workspace. Settings sync automatically across devices.</p>
  </div>
"""

PAGE_CSS = """
  .browser{position:absolute;background:#fff;border-radius:16px;overflow:hidden;
    box-shadow:0 40px 90px rgba(20,16,60,.34),0 8px 24px rgba(20,16,60,.18);}
  .chrome-bar{height:52px;display:flex;align-items:center;gap:14px;padding:0 18px;
    background:#f1f2f5;border-bottom:1px solid #e3e5ea;}
  .dots{display:flex;gap:8px;}
  .dots i{width:12px;height:12px;border-radius:50%;display:block;}
  .dots i:nth-child(1){background:#ff5f57;}.dots i:nth-child(2){background:#febc2e;}
  .dots i:nth-child(3){background:#28c840;}
  .url{flex:1;height:30px;border-radius:8px;background:#fff;border:1px solid #e0e2e8;
    display:flex;align-items:center;gap:8px;padding:0 14px;color:#8a8f9c;font-size:14px;}
  .url b{color:#2b2f3a;font-weight:600;}
  .pageicon{width:20px;height:20px;border-radius:6px;}
  .stack{display:flex;height:calc(100% - 52px);}
  .viewport{position:relative;overflow:hidden;background:#fff;}
  .doc{padding:38px 44px;color:#1c2030;}
  .eyebrow{font-size:12px;font-weight:800;letter-spacing:.14em;color:#8b8fa0;}
  .doc-title{font-size:34px;line-height:1.14;margin:10px 0 14px;font-weight:800;
    letter-spacing:-.02em;color:#141826;}
  .lead{font-size:17px;line-height:1.55;color:#565c6c;margin:0 0 22px;}
  .hero-img{height:120px;border-radius:12px;margin:0 0 24px;
    background:linear-gradient(120deg,#e9e6ff,#dfeaff 60%,#ffe6ee);}
  .doc h2{font-size:20px;margin:22px 0 9px;color:#1c2030;}
  .doc p{font-size:15px;line-height:1.65;color:#5b6170;margin:0 0 12px;}
  .panel-dock{flex:none;border-left:1px solid #e4e6eb;background:#f5f6f8;overflow:hidden;}
  .panel-dock img{display:block;}
"""


def overlay(key, vw, vh):
    """장면별 주석 SVG + 플로팅 칩. viewBox 좌표는 뷰포트(vw x vh) 기준.

    문서 레이아웃(padding 38 44): 제목 y~70-140, 리드 y~155-205,
    히어로 이미지 y~225-345, h2 "1. Install" y~370.
    """
    cx = round(vw * 0.41)
    rx = round(vw * 0.40)
    svg_open = f'<svg class="ann" viewBox="0 0 {vw} {vh}" width="{vw}" height="{vh}">'
    # 제목을 감싸는 원
    circle = (
        f'<ellipse cx="{cx}" cy="102" rx="{rx}" ry="40" fill="none" stroke="{PINK}" '
        f'stroke-width="5" stroke-linecap="round" transform="rotate(-1.5 {cx} 102)"/>'
    )
    # 히어로 이미지를 가리키는 화살표
    arrow = (
        f'<path d="M{round(vw*0.66)} 178 C{round(vw*0.80)} 200 {round(vw*0.78)} 250 '
        f'{round(vw*0.60)} 262" fill="none" stroke="#2684ff" stroke-width="5" '
        'stroke-linecap="round"/>'
        f'<path d="M{round(vw*0.60)} 262 l16 -5 m-16 5 l6 -15" fill="none" '
        'stroke="#2684ff" stroke-width="5" stroke-linecap="round"/>'
    )
    # h2 아래 형광펜 밑줄
    hl = (
        f'<path d="M44 392 q{round(vw*0.16)} -16 {round(vw*0.40)} -2" '
        'fill="none" stroke="#ffb020" stroke-width="11" stroke-linecap="round" '
        'opacity="0.5"/>'
    )

    if key == "draw":
        return svg_open + circle + hl + arrow + "</svg>"
    if key == "text":
        return (
            svg_open
            + f'<path d="M44 392 q{round(vw*0.16)} -15 {round(vw*0.40)} -2" '
            'fill="none" stroke="#2ecc71" stroke-width="10" stroke-linecap="round" '
            'opacity="0.5"/></svg>'
            + '<div class="note pink" style="left:10%;top:250px;">Start with step 1 👇</div>'
            + '<div class="note" style="left:45%;top:356px;">'
            'Ask the team<br>before step 2</div>'
        )
    if key == "save":
        return (
            svg_open + circle + hl + "</svg>"
            + '<div class="chip"><span class="chip-ic">⬇</span>'
            '<span><b>markerly-2026-07-19.png</b><br>'
            '<small>Saved to Downloads</small></span></div>'
        )
    if key == "sequence":
        return (
            svg_open + circle + "</svg>"
            + '<div class="rec"><span class="rec-dot"></span>REC&nbsp;&nbsp;3 / 10</div>'
            + '<div class="chip"><span class="chip-ic">🗜</span>'
            '<span><b>markerly-sequence.zip</b><br>'
            '<small>Up to 10 shots, one file</small></span></div>'
        )
    return svg_open + "</svg>"


SCENES = [
    ("markerly-1-draw", "draw", "Draw on any webpage",
     "Pen, colors, thickness and opacity — right where you need them."),
    ("markerly-2-text", "text", "Drop notes anywhere",
     "Click to place text, drag to reposition. Explain as you go."),
    ("markerly-3-save", "save", "Save the page and your notes as one PNG",
     "Annotations merge with the page. Nothing leaves your device."),
    ("markerly-4-sequence", "sequence", "Burst-capture into a single ZIP",
     "3 / 5 / 10-second intervals — up to 10 shots, bundled automatically."),
]

# 브라우저 목업 배치 (1280x800 캔버스)
BR_LEFT, BR_TOP, BR_W, BR_H = 452, 118, 764, 632
BODY_H = BR_H - 52  # 크롬바 제외


def build_scene_html(key, title, subtitle, panel_disp_w, panel_disp_h, vw):
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      html,body{{margin:0;width:1280px;height:800px;overflow:hidden;
        font-family:'Segoe UI',system-ui,-apple-system,'Malgun Gothic',sans-serif;}}
      .stage{{position:relative;width:1280px;height:800px;overflow:hidden;
        background:radial-gradient(125% 125% at 10% -5%,#7d6ff5 0%,#5a49dd 46%,#4131bb 100%);}}
      .stage::before{{content:"";position:absolute;right:-120px;top:-150px;width:480px;
        height:480px;border-radius:50%;background:rgba(255,255,255,.08);}}
      .stage::after{{content:"";position:absolute;left:-90px;bottom:-160px;width:420px;
        height:420px;border-radius:50%;background:rgba(255,255,255,.06);}}
      .brand{{position:absolute;left:72px;top:56px;display:flex;align-items:center;
        gap:12px;color:#fff;font-size:22px;font-weight:800;letter-spacing:-.01em;}}
      .brand img{{width:40px;height:40px;border-radius:11px;}}
      .headline{{position:absolute;left:72px;top:150px;width:330px;margin:0;color:#fff;
        font-size:46px;line-height:1.13;font-weight:800;letter-spacing:-.02em;}}
      .sub{{position:absolute;left:72px;width:320px;margin:0;
        color:rgba(255,255,255,.92);font-size:20px;line-height:1.5;}}
      .tag{{position:absolute;left:72px;bottom:60px;color:rgba(255,255,255,.82);
        font-size:16px;font-weight:600;letter-spacing:.02em;}}
      {PAGE_CSS}
      .browser{{left:{BR_LEFT}px;top:{BR_TOP}px;width:{BR_W}px;height:{BR_H}px;}}
      .viewport{{width:{vw}px;height:{BODY_H}px;}}
      .panel-dock{{width:{panel_disp_w}px;height:{BODY_H}px;}}
      .panel-dock img{{width:{panel_disp_w}px;height:{panel_disp_h}px;}}
      .ann{{position:absolute;left:0;top:0;pointer-events:none;}}
      .note{{position:absolute;background:#fff;color:#1c2030;font-size:15px;font-weight:600;
        line-height:1.35;padding:9px 13px;border-radius:12px;
        box-shadow:0 10px 24px rgba(20,16,60,.2);border:2px solid #2ecc71;}}
      .note.pink{{border-color:{PINK};}}
      .chip{{position:absolute;left:30px;bottom:26px;display:flex;align-items:center;gap:12px;
        background:#fff;border-radius:14px;padding:11px 16px;color:#1c2030;font-size:14px;
        box-shadow:0 16px 40px rgba(20,16,60,.3);}}
      .chip b{{font-weight:700;}} .chip small{{color:#8b909d;font-size:12px;}}
      .chip-ic{{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;
        background:{BRAND};color:#fff;font-size:17px;}}
      .rec{{position:absolute;right:22px;top:18px;display:flex;align-items:center;gap:9px;
        background:#df3652;color:#fff;font-size:14px;font-weight:800;letter-spacing:.04em;
        padding:7px 14px;border-radius:999px;box-shadow:0 10px 26px rgba(223,54,82,.45);}}
      .rec-dot{{width:10px;height:10px;border-radius:50%;background:#fff;}}
    </style></head><body>
      <div class="stage">
        <div class="brand"><img src="{icon_uri()}">Markerly</div>
        <h1 class="headline">{title}</h1>
        <p class="sub" style="top:370px">{subtitle}</p>
        <div class="tag">Mark. Highlight. Capture.</div>
        <div class="browser">
          <div class="chrome-bar">
            <div class="dots"><i></i><i></i><i></i></div>
            <div class="url"><img class="pageicon" src="{icon_uri()}">
              <span>example.com/docs/&nbsp;<b>getting-started</b></span></div>
          </div>
          <div class="stack">
            <div class="viewport">
              {SAMPLE_PAGE}
              {overlay(key, vw, BODY_H)}
            </div>
            <div class="panel-dock"><img src="{data_uri(PANEL_PNG)}"></div>
          </div>
        </div>
      </div>
    </body></html>"""


def build_promo_html():
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      html,body{{margin:0;width:440px;height:280px;overflow:hidden;
        font-family:'Segoe UI',system-ui,-apple-system,sans-serif;}}
      .wrap{{position:relative;width:440px;height:280px;display:flex;flex-direction:column;
        align-items:center;justify-content:center;gap:14px;color:#fff;
        background:radial-gradient(125% 125% at 15% -5%,#7d6ff5,#5a49dd 55%,#4131bb);}}
      .wrap::before{{content:"";position:absolute;right:-60px;top:-70px;width:220px;height:220px;
        border-radius:50%;background:rgba(255,255,255,.08);}}
      img{{width:96px;height:96px;filter:drop-shadow(0 12px 26px rgba(0,0,0,.32));}}
      h1{{font-size:38px;margin:0;font-weight:800;letter-spacing:-.02em;}}
      p{{font-size:17px;margin:0;opacity:.92;font-weight:600;letter-spacing:.02em;}}
    </style></head><body><div class="wrap">
      <img src="{icon_uri()}"><h1>Markerly</h1><p>Mark. Highlight. Capture.</p>
    </div></body></html>"""


PANEL_PNG = None  # render_panel() 이후 설정


def main():
    global PANEL_PNG
    if not os.path.exists(CHROME):
        raise SystemExit(f"Chrome not found at {CHROME} (set CHROME env var)")
    os.makedirs(SHOTS, exist_ok=True)
    os.makedirs(STORE, exist_ok=True)

    PANEL_PNG = render_panel()

    # 패널을 브라우저 본문 높이에 맞춰 비율 유지 스케일
    pw, ph = Image.open(PANEL_PNG).size
    panel_disp_h = BODY_H
    panel_disp_w = round(pw * BODY_H / ph)
    vw = BR_W - panel_disp_w

    for name, key, title, sub in SCENES:
        html = build_scene_html(key, title, sub, panel_disp_w, panel_disp_h, vw)
        p = os.path.join(TMP, name + ".html")
        open(p, "w", encoding="utf-8").write(html)
        out = os.path.join(SHOTS, name + ".png")
        chrome_shot(p, out, 1280, 800, scale=1)
        print("wrote", os.path.relpath(out, ROOT))

    # 스토어 아이콘
    shutil.copyfile(
        os.path.join(ROOT, "icons", "icon128.png"),
        os.path.join(STORE, "store-icon-128.png"),
    )
    print("wrote", os.path.relpath(os.path.join(STORE, "store-icon-128.png"), ROOT))

    # 프로모 타일 (2x 렌더 후 축소)
    promo_html = os.path.join(TMP, "promo.html")
    open(promo_html, "w", encoding="utf-8").write(build_promo_html())
    promo_big = os.path.join(TMP, "promo-big.png")
    chrome_shot(promo_html, promo_big, 440, 280, scale=2)
    promo_out = os.path.join(STORE, "promo-tile-440x280.png")
    Image.open(promo_big).convert("RGB").resize((440, 280), Image.LANCZOS).save(promo_out)
    print("wrote", os.path.relpath(promo_out, ROOT))

    shutil.rmtree(TMP, ignore_errors=True)


if __name__ == "__main__":
    main()
