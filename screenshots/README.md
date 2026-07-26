# Store screenshots

Chrome Web Store에 제출할 1280×800 스크린샷을 이 디렉터리에 보관합니다.
아래 이미지는 `tools/make_store_assets.py`로 자동 생성됩니다.

- `markerly-panel.png` — 실제 사이드 패널 세로 스크린샷(블로그·README용)
- `markerly-1-draw.png` — 웹페이지 위 펜 주석
- `markerly-2-text.png` — 글자 입력과 드래그 이동
- `markerly-3-save.png` — 배경과 주석이 포함된 PNG 저장
- `markerly-4-sequence.png` — 최대 10장의 연속 캡처 ZIP

## 다시 생성하기

```powershell
python tools/make_store_assets.py
```

헤드리스 Chrome으로 `sidepanel.html`을 실제 렌더링한 뒤 브라우저 목업·주석·카피와
합성합니다. Google Chrome과 Pillow(`pip install pillow`)가 필요합니다.
Chrome 경로가 다르면 `CHROME` 환경 변수로 지정하세요.
