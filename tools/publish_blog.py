#!/usr/bin/env python3
"""Blogger API v3로 블로그 글을 자동 게시/갱신(upsert)하는 도구.

- 순수 requests + 표준 라이브러리만 사용(구글 클라이언트 라이브러리 불필요).
- 최초 1회 브라우저 OAuth 동의로 리프레시 토큰을 발급받아 token.json에 저장.
  이후 실행은 저장된 토큰으로 자동 인증한다.
- tools/blog-config.json의 posts[] 항목마다 postId가 있으면 update(PUT),
  없으면 insert(POST) 후 반환된 id를 config에 다시 저장한다.
- 본문은 HTML 파일에서 CDATA를 벗기고 <style> + <body> 내용을 그대로 사용한다.
  assetBaseUrl이 설정되면 "../" 상대경로를 절대 URL로 치환한다.

준비물: tools/client_secret.json (Google Cloud 데스크톱 OAuth 클라이언트).
        설정 방법은 tools/BLOGGER-SETUP.md 참고.

사용법:
  python tools/publish_blog.py            # 모든 글 게시/갱신(공개)
  python tools/publish_blog.py --draft    # 초안으로 게시/갱신
  python tools/publish_blog.py --only blog/how-to-use-markerly.html
  python tools/publish_blog.py --dry-run  # 인증/API 없이 본문 추출만 미리보기
"""
import argparse
import http.server
import json
import os
import re
import sys
import threading
import time
import urllib.parse
import webbrowser

import requests

# Windows 콘솔(cp949)에서도 유니코드 출력이 깨지지 않도록.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")
CONFIG = os.path.join(TOOLS, "blog-config.json")
CLIENT_SECRET = os.path.join(TOOLS, "client_secret.json")
TOKEN = os.path.join(TOOLS, "token.json")

SCOPE = "https://www.googleapis.com/auth/blogger"
API = "https://www.googleapis.com/blogger/v3"


# ---------------------------------------------------------------------------
# 작은 유틸
# ---------------------------------------------------------------------------


def load_json(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def die(msg):
    print("오류:", msg, file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# OAuth2 (설치형 앱 / 루프백 리다이렉트)
# ---------------------------------------------------------------------------


def _client_conf():
    data = load_json(CLIENT_SECRET)
    if not data:
        die(
            f"{os.path.relpath(CLIENT_SECRET, ROOT)} 가 없습니다. "
            "tools/BLOGGER-SETUP.md 를 보고 OAuth 클라이언트를 내려받으세요."
        )
    return data.get("installed") or data.get("web") or die("client_secret 형식 오류")


class _CodeHandler(http.server.BaseHTTPRequestHandler):
    code = None
    error = None

    def do_GET(self):
        qs = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(qs)
        _CodeHandler.code = params.get("code", [None])[0]
        _CodeHandler.error = params.get("error", [None])[0]
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        msg = "인증 완료 — 이 창을 닫고 터미널로 돌아가세요." if _CodeHandler.code \
            else f"인증 실패: {_CodeHandler.error}"
        self.wfile.write(f"<html><body style='font-family:sans-serif'><h2>{msg}</h2>"
                         "</body></html>".encode("utf-8"))

    def log_message(self, *a):
        pass


def _authorize():
    """브라우저 동의 → 코드 수신 → 토큰 교환. token.json 저장."""
    conf = _client_conf()
    server = http.server.HTTPServer(("127.0.0.1", 0), _CodeHandler)
    port = server.server_address[1]
    redirect_uri = f"http://127.0.0.1:{port}/"

    auth_url = conf["auth_uri"] + "?" + urllib.parse.urlencode({
        "client_id": conf["client_id"],
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        "prompt": "consent",
    })
    print("브라우저에서 Google 로그인 및 동의를 진행하세요.")
    print("자동으로 열리지 않으면 아래 주소를 직접 여세요:\n", auth_url)
    webbrowser.open(auth_url)

    thread = threading.Thread(target=server.handle_request)
    thread.start()
    thread.join(timeout=300)
    server.server_close()
    if not _CodeHandler.code:
        die(f"인증 코드를 받지 못했습니다 ({_CodeHandler.error or 'timeout'})")

    resp = requests.post(conf["token_uri"], data={
        "code": _CodeHandler.code,
        "client_id": conf["client_id"],
        "client_secret": conf["client_secret"],
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }, timeout=30)
    resp.raise_for_status()
    tok = resp.json()
    tok["obtained_at"] = int(time.time())
    save_json(TOKEN, tok)
    print("토큰을 저장했습니다:", os.path.relpath(TOKEN, ROOT))
    return tok


def _refresh(tok):
    conf = _client_conf()
    resp = requests.post(conf["token_uri"], data={
        "refresh_token": tok["refresh_token"],
        "client_id": conf["client_id"],
        "client_secret": conf["client_secret"],
        "grant_type": "refresh_token",
    }, timeout=30)
    resp.raise_for_status()
    new = resp.json()
    tok.update(new)
    tok["obtained_at"] = int(time.time())
    save_json(TOKEN, tok)
    return tok


def access_token():
    """유효한 액세스 토큰을 반환(필요 시 발급/갱신)."""
    tok = load_json(TOKEN)
    if not tok:
        tok = _authorize()
    expires_in = tok.get("expires_in", 3600)
    if time.time() - tok.get("obtained_at", 0) > expires_in - 120:
        if tok.get("refresh_token"):
            tok = _refresh(tok)
        else:
            tok = _authorize()
    return tok["access_token"]


# ---------------------------------------------------------------------------
# Blogger API
# ---------------------------------------------------------------------------


def _auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def resolve_blog_id(cfg, token):
    if cfg.get("blogId"):
        return cfg["blogId"]
    url = cfg.get("blogUrl")
    if not url:
        die("blog-config.json 에 blogId 또는 blogUrl 을 지정하세요.")
    r = requests.get(f"{API}/blogs/byurl", params={"url": url},
                     headers=_auth_headers(token), timeout=30)
    if r.status_code != 200:
        die(f"blogUrl 로 blogId 조회 실패({r.status_code}): {r.text}")
    cfg["blogId"] = r.json()["id"]
    save_json(CONFIG, cfg)
    print("blogId 확인:", cfg["blogId"])
    return cfg["blogId"]


def upsert_post(blog_id, token, post, title, content, draft):
    body = {"kind": "blogger#post", "title": title, "content": content}
    if post.get("labels"):
        body["labels"] = post["labels"]
    if post.get("postId"):
        r = requests.put(
            f"{API}/blogs/{blog_id}/posts/{post['postId']}",
            headers=_auth_headers(token), params={"publish": str(not draft).lower()},
            data=json.dumps(body), timeout=60)
        action = "update"
    else:
        r = requests.post(
            f"{API}/blogs/{blog_id}/posts/",
            headers=_auth_headers(token), params={"isDraft": str(draft).lower()},
            data=json.dumps(body), timeout=60)
        action = "insert"
    if r.status_code not in (200, 201):
        die(f"{action} 실패({r.status_code}): {r.text}")
    result = r.json()
    return action, result


# ---------------------------------------------------------------------------
# 본문 추출
# ---------------------------------------------------------------------------


def extract(file_path, asset_base=""):
    raw = open(file_path, encoding="utf-8").read().strip()
    # CDATA 벗기기
    raw = re.sub(r"^<!\[CDATA\[", "", raw)
    raw = re.sub(r"\]\]>\s*$", "", raw).strip()

    m = re.search(r"<title[^>]*>(.*?)</title>", raw, re.S | re.I)
    title = re.sub(r"\s+", " ", m.group(1)).strip() if m else os.path.basename(file_path)

    styles = re.findall(r"<style[^>]*>.*?</style>", raw, re.S | re.I)
    bm = re.search(r"<body[^>]*>(.*?)</body>", raw, re.S | re.I)
    body = bm.group(1).strip() if bm else raw

    content = ("\n".join(styles) + "\n" + body).strip()
    if asset_base:
        base = asset_base.rstrip("/")
        # blog/ 기준 "../" -> 저장소 루트 절대 URL
        content = content.replace('="../', f'="{base}/')
    return title, content


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser(description="Blogger 글 자동 게시/갱신")
    ap.add_argument("--draft", action="store_true", help="초안으로 게시/갱신")
    ap.add_argument("--only", help="특정 파일 하나만 처리(config의 file 값)")
    ap.add_argument("--dry-run", action="store_true",
                    help="인증/API 없이 본문 추출만 tools/preview-*.html 로 미리보기")
    args = ap.parse_args()

    cfg = load_json(CONFIG)
    if not cfg:
        die(f"{os.path.relpath(CONFIG, ROOT)} 가 없습니다.")
    posts = cfg.get("posts", [])
    if args.only:
        posts = [p for p in posts if p["file"] == args.only]
        if not posts:
            die(f"config에서 file={args.only} 항목을 찾지 못했습니다.")
    asset_base = cfg.get("assetBaseUrl", "")

    if args.dry_run:
        for p in posts:
            fp = os.path.join(ROOT, p["file"])
            if not os.path.exists(fp):
                print("건너뜀(파일 없음):", p["file"]); continue
            title, content = extract(fp, asset_base)
            out = os.path.join(TOOLS, "preview-" + os.path.basename(p["file"]))
            open(out, "w", encoding="utf-8").write(content)
            print(f"· {p['file']}")
            print(f"    제목: {title}")
            print(f"    본문 길이: {len(content):,}자  → {os.path.relpath(out, ROOT)}")
        if not asset_base:
            print("\n경고: assetBaseUrl 이 비어 있어 이미지가 상대경로입니다. "
                  "Blogger에서 이미지가 보이지 않을 수 있습니다.")
        return

    token = access_token()
    blog_id = resolve_blog_id(cfg, token)
    changed = False
    for p in posts:
        fp = os.path.join(ROOT, p["file"])
        if not os.path.exists(fp):
            print("건너뜀(파일 없음):", p["file"]); continue
        title, content = extract(fp, asset_base)
        action, result = upsert_post(blog_id, token, p, title, content, args.draft)
        if action == "insert":
            p["postId"] = result["id"]
            changed = True
        state = "초안" if args.draft else "공개"
        print(f"[{action}/{state}] {title}")
        print("   ", result.get("url", "(url 없음)"), "id=", result["id"])
    if changed:
        save_json(CONFIG, cfg)
        print("새 post ID를 blog-config.json 에 저장했습니다.")


if __name__ == "__main__":
    main()
