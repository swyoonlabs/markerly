# Blogger 자동 게시 설정 가이드

`tools/publish_blog.py`로 KO/EN 블로그 글을 Blogger에 자동 게시·갱신합니다.
글 작성·수정은 **OAuth2 사용자 인증**이 필요합니다(API 키만으로는 읽기만 가능).
아래 순서를 한 번만 마치면, 이후엔 저장된 토큰으로 자동 실행됩니다.

## 필요한 것

- 파이썬 3 + `requests` (이미 설치되어 있음: `pip install requests`)
- Google 계정으로 만든 Blogger 블로그
- Google Cloud OAuth 데스크톱 클라이언트 (아래에서 발급)

---

## 1. Google Cloud 프로젝트 만들기 & Blogger API 켜기

1. https://console.cloud.google.com 접속 → 상단에서 **프로젝트 만들기**(이름 예: `markerly-blog`).
2. 좌측 메뉴 **API 및 서비스 → 라이브러리** 이동.
3. `Blogger API v3` 검색 → **사용 설정(Enable)**.

## 2. OAuth 동의 화면 구성

1. **API 및 서비스 → OAuth 동의 화면**.
2. User Type: **외부(External)** 선택 → 만들기.
3. 앱 이름/이메일 등 필수 항목만 입력하고 저장.
4. **대상(Audience)** 단계에서 **테스트 사용자**에 본인 Google 계정을 추가.
   (앱을 "게시"하지 않아도 테스트 사용자는 사용할 수 있습니다.)
5. 범위(Scopes)는 추가하지 않아도 됩니다. 스크립트가 실행 시 요청합니다.

## 3. OAuth 클라이언트(데스크톱) 발급

1. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**.
2. 애플리케이션 유형: **데스크톱 앱** 선택 → 만들기.
3. 생성된 클라이언트의 **JSON 다운로드**를 눌러 파일을 받습니다.
4. 받은 파일을 이 저장소의 **`tools/client_secret.json`** 으로 저장합니다.

> `client_secret.json`과 `token.json`은 비밀 정보라 `.gitignore`에 등록되어 있습니다.
> 커밋되지 않도록 주의하세요.

## 4. blog-config.json 채우기

`tools/blog-config.json`을 열어 값을 채웁니다.

```json
{
  "blogUrl": "https://내블로그.blogspot.com",
  "blogId": "",
  "assetBaseUrl": "https://raw.githubusercontent.com/swyoonlabs/markerly/main",
  "posts": [
    { "file": "blog/how-to-use-markerly.html",    "postId": "", "labels": ["Markerly","Chrome 확장","사용법"] },
    { "file": "blog/how-to-use-markerly-en.html", "postId": "", "labels": ["Markerly","Chrome Extension","Guide"] }
  ]
}
```

- `blogUrl`: 내 Blogger 블로그 주소. `blogId`는 비워두면 자동으로 조회해 채워줍니다.
- `assetBaseUrl`: 글의 `../screenshots/...` 상대 이미지 경로를 절대 URL로 바꿀 기준 주소입니다.
  - Blogger는 이미지를 절대 URL로만 표시하므로 **필수에 가깝습니다.**
  - 위 예시(GitHub raw)는 **저장소가 공개(public)** 여야 이미지가 보입니다.
    비공개라면 GitHub Pages, 이미지 호스팅, 또는 Blogger 편집기에 직접 업로드한 이미지 URL을 쓰세요.
  - 비워두면 이미지가 깨질 수 있습니다(경고가 출력됩니다).
- `postId`: 비워두면 신규 글로 만들고, 생성된 ID를 자동으로 여기에 저장합니다.
  다음 실행부터는 그 ID로 **갱신(update)** 합니다.

## 5. 실행

```powershell
# 먼저 인증/본문만 점검 (API 호출 없음)
python tools/publish_blog.py --dry-run

# 초안으로 올려 확인
python tools/publish_blog.py --draft

# 문제 없으면 공개로 게시/갱신
python tools/publish_blog.py

# 특정 글 하나만
python tools/publish_blog.py --only blog/how-to-use-markerly.html
```

- **첫 실행 시** 브라우저가 열립니다. Google 로그인 → 권한 동의를 하면
  `tools/token.json`이 생성되고, 이후 실행은 자동 인증됩니다.
- "확인되지 않은 앱" 경고가 나오면 **고급 → (안전하지 않음) 이동**을 눌러 진행하세요.
  (본인이 만든 테스트 앱이라 정상입니다.)

## 자동화(선택)

글을 수정한 뒤 매번 최신 상태로 반영하려면, 배포 파이프라인이나 예약 작업에서
`python tools/publish_blog.py` 를 호출하면 됩니다. `token.json`이 있으면 브라우저 없이 실행됩니다.
(리프레시 토큰은 장기간 유효하지만, 앱이 "테스트" 상태면 주기적으로 만료될 수 있습니다.
자주 자동화한다면 OAuth 동의 화면을 "프로덕션"으로 게시하는 것을 권장합니다.)

## 문제 해결

- `client_secret.json 가 없습니다` → 3단계에서 받은 파일을 `tools/` 에 저장했는지 확인.
- `blogUrl 로 blogId 조회 실패` → 블로그 주소가 정확한지, 로그인 계정이 그 블로그의 소유자인지 확인.
- 이미지가 안 보임 → `assetBaseUrl`이 공개 URL을 가리키는지 확인.
- 디자인이 깨짐 → 블로그 테마 CSS와 본문 `<style>`이 충돌할 수 있습니다.
  이때는 본문만 추출하는 방식으로 바꾸거나, 클래스 접두어를 다는 방법을 쓸 수 있습니다(요청 시 도와드립니다).
