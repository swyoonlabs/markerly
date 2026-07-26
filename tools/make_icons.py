#!/usr/bin/env python3
"""Markerly 아이콘 생성기.

`icons/icon.svg`를 단일 소스로 삼아 헤드리스 Chrome으로 고해상도(1024px)
래스터화한 뒤 PIL(LANCZOS)로 축소해 부드러운 PNG 아이콘을 만듭니다.

산출물: icons/icon16.png, icon32.png, icon48.png, icon128.png

필요: Google Chrome, Pillow(PIL).
사용법: python tools/make_icons.py
Chrome 경로 지정: set CHROME=C:\\path\\to\\chrome.exe && python tools/make_icons.py
"""
import os
import subprocess
import tempfile

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "icons")
SVG = os.path.join(ICONS, "icon.svg")
SIZES = (16, 32, 48, 128)
RENDER = 1024  # 고해상도 렌더 후 축소(슈퍼샘플링)

CHROME = os.environ.get(
    "CHROME", r"C:\Program Files\Google\Chrome\Application\chrome.exe"
)


def chrome_shot(html_path, out_path, size):
    subprocess.run(
        [
            CHROME,
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--allow-file-access-from-files",
            "--default-background-color=00000000",  # 투명 배경(라운드 코너)
            "--force-device-scale-factor=1",
            f"--window-size={size},{size}",
            f"--screenshot={out_path}",
            "--virtual-time-budget=1200",
            f"file://{html_path}",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def main():
    if not os.path.exists(CHROME):
        raise SystemExit(f"Chrome not found at {CHROME} (set CHROME env var)")
    if not os.path.exists(SVG):
        raise SystemExit(f"Source SVG not found: {SVG}")

    svg = open(SVG, encoding="utf-8").read()
    html = (
        "<!DOCTYPE html><html><head><meta charset='utf-8'><style>"
        "html,body{margin:0;padding:0;background:transparent;}"
        f"svg{{display:block;width:{RENDER}px;height:{RENDER}px;}}"
        "</style></head><body>" + svg + "</body></html>"
    )
    with tempfile.TemporaryDirectory(prefix="markerly-icons-") as tmp:
        html_path = os.path.join(tmp, "icon.html")
        open(html_path, "w", encoding="utf-8").write(html)
        big = os.path.join(tmp, "icon-1024.png")
        chrome_shot(html_path, big, RENDER)

        src = Image.open(big).convert("RGBA")
        if src.size != (RENDER, RENDER):
            src = src.resize((RENDER, RENDER), Image.LANCZOS)
        for size in SIZES:
            out = os.path.join(ICONS, f"icon{size}.png")
            src.resize((size, size), Image.LANCZOS).save(out, "PNG")
            print("wrote", os.path.relpath(out, ROOT))


if __name__ == "__main__":
    main()
