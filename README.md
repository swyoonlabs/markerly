# Markerly

Markerly는 웹페이지 위에 투명 캔버스를 띄워 밑줄·강조·메모를 표시할 수 있는 Chrome Manifest V3 확장 프로그램입니다.

> Mark. Highlight. Capture.

## 기능

- 탭별 캔버스 ON/OFF 및 작업 모드 유지
- 펜 색상, 굵기, 불투명도 설정
- 펜과 별도의 크기를 사용하는 지우개
- 클릭한 위치에 글자 입력 및 기존 글자 드래그 이동
- 페이지 조작 모드
- 오른쪽 클릭 전체 삭제 옵션
- 웹페이지 배경과 그림을 합친 PNG 화면 저장
- 3초·5초·10초 간격 연속 캡처 후 최대 10장을 ZIP 한 번에 저장
- 같은 탭과 URL을 새로고침했을 때 그림 자동 복원
- 웹페이지 위에는 Canvas 외의 안내 UI를 표시하지 않음
- 브라우저 언어에 맞춘 9개 언어 인터페이스(영어 기본): 한국어, 日本語, 中文(简体), Español, Français, Deutsch, Português (Brasil), Русский

그림 데이터는 브라우저 세션에만 보관되며 해당 탭을 닫으면 자동으로 삭제됩니다. 캡처 이미지는 외부 서버로 전송하지 않고 사용자 기기에 직접 저장합니다.

## 설치

1. Chrome에서 `chrome://extensions`를 엽니다.
2. 오른쪽 위의 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 누릅니다.
4. 이 프로젝트 폴더를 선택합니다.
5. 툴바의 확장 프로그램 아이콘을 누르면 사이드 패널이 열립니다.

이미 설치한 상태에서 코드를 변경했다면 `chrome://extensions`에서 확장 프로그램의 **새로고침** 버튼을 누르세요.

## 사용

1. 일반 웹페이지에서 사이드 패널을 엽니다.
2. 오른쪽 위 토글로 현재 탭의 Canvas를 켭니다.
3. **그리기**, **지우기**, **페이지** 중 필요한 동작을 선택합니다.
4. **현재 화면 저장**을 누르면 보이는 웹페이지와 그림이 하나의 PNG로 저장됩니다.
5. 연속 캡처 간격을 고르고 **연속 캡처 시작**을 누르면 최대 10장의 이미지가 ZIP 하나로 저장됩니다.

Chrome 내부 페이지(`chrome://...`)와 Chrome 웹 스토어에서는 보안 정책상 사용할 수 없습니다. 로컬 HTML 파일에서 사용하려면 확장 프로그램 세부정보에서 **파일 URL에 대한 액세스 허용**을 켜세요.

## 저장소 구조

- 루트: 확장 프로그램 런타임 파일
- `icons/`: Manifest 및 스토어 아이콘(`icon.svg`가 원본)
- `_locales/`: Chrome 확장 프로그램 다국어 번역(9개 언어)
- `screenshots/`: Chrome Web Store 스크린샷
- `scripts/`: 배포 패키지 생성 도구
- `store-assets/`: 스토어 설명, 권한 설명, 개인정보처리방침, 스토어 아이콘·프로모 타일
- `tools/`: 아이콘·스토어 이미지 자동 생성 도구
- `dist/`: Chrome Web Store 업로드 및 GitHub 배포용 ZIP

스토어 업로드 ZIP은 PowerShell에서 `./scripts/package-extension.ps1`을 실행해 생성합니다.

## 이미지 자동 생성

아이콘과 스토어 이미지는 Python 스크립트로 다시 만들 수 있습니다. Google Chrome과
Pillow(`pip install pillow`)가 필요합니다.

```powershell
python tools/make_icons.py          # icons/icon.svg -> icon16/32/48/128.png
python tools/make_store_assets.py   # 세로 패널·1280x800 스크린샷·스토어 아이콘·프로모 타일
```

- `tools/make_icons.py`: `icons/icon.svg`를 고해상도로 래스터화 후 축소해 PNG 아이콘 생성
- `tools/make_store_assets.py`: 헤드리스 Chrome으로 실제 사이드 패널을 렌더링하고
  브라우저 목업·주석·카피와 합성해 `screenshots/`와 `store-assets/` 이미지 생성

Chrome 설치 경로가 다르면 `CHROME` 환경 변수로 실행 파일을 지정하세요.

## 블로그 자동 게시 (Blogger API)

`blog/` 의 KO/EN 가이드 글을 Blogger에 자동으로 게시·갱신할 수 있습니다.

```powershell
python tools/publish_blog.py --dry-run   # 본문 추출만 미리보기(API 호출 없음)
python tools/publish_blog.py --draft     # 초안으로 게시/갱신
python tools/publish_blog.py             # 공개로 게시/갱신(upsert)
```

- 신규 글은 만들고 반환된 post ID를 `tools/blog-config.json` 에 저장해, 다음 실행부터 자동 갱신합니다.
- 글 작성·수정은 OAuth2 사용자 인증이 필요합니다. 최초 1회 설정은 [tools/BLOGGER-SETUP.md](tools/BLOGGER-SETUP.md) 참고.
- OAuth 비밀 파일(`tools/client_secret.json`, `tools/token.json`)은 `.gitignore`에 등록되어 있습니다.
