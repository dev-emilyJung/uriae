#!/usr/bin/env python3
"""우리애 한눈에 홈페이지 의견 접수. 표준 라이브러리만 쓰고, nginx 뒤 127.0.0.1:8787 에서 동작한다.

  POST /api/feedback           의견 저장
  GET  /api/feedback/summary   공개: 받은 의견 수, 평균 별점
  GET  /api/admin/feedback     관리자(nginx 비밀번호): 전체 목록

방문자 IP 는 저장하지 않는다. 같은 곳에서 연속으로 보내는 것을 막는 데에만 메모리에서 잠깐 쓴다.
의견은 받은 날로부터 1년이 지나면 지운다. 요청 하나씩 차례로 처리하므로(스레드 없음) 파일 잠금이 필요 없다.
"""
import json
import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

DATA = os.path.join(os.environ.get('STATE_DIRECTORY', '/var/lib/uriae'), 'feedback.jsonl')
HOST = os.environ.get('FEEDBACK_HOST', '127.0.0.1')
PORT = int(os.environ.get('FEEDBACK_PORT', '8787'))
KST = timezone(timedelta(hours=9))
KINDS = ('review', 'problem', 'idea')  # 후기, 불편·오류, 바라는 기능
MAX_TEXT = 2000
MAX_BODY = 16 * 1024
KEEP_DAYS = 365
LIMIT = (5, 600)  # 같은 곳에서 10분에 5개까지
EMAIL = re.compile(r'^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$')

recent = {}  # ip → 최근 보낸 시각들 (메모리에만)


def load():
    try:
        with open(DATA, encoding='utf-8') as f:
            return [json.loads(line) for line in f if line.strip()]
    except FileNotFoundError:
        return []


def save_all(items):
    tmp = DATA + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        for it in items:
            f.write(json.dumps(it, ensure_ascii=False) + '\n')
    os.replace(tmp, DATA)


def prune(items):
    """1년 지난 의견 지우기. 지운 게 있으면 파일도 다시 쓴다."""
    cut = (datetime.now(KST) - timedelta(days=KEEP_DAYS)).isoformat()
    kept = [it for it in items if it.get('at', '') >= cut]
    if len(kept) != len(items):
        save_all(kept)
    return kept


def summary(items):
    rated = [it['rating'] for it in items if it.get('rating')]
    return {
        'count': len(items),
        'rated': len(rated),
        'avg': round(sum(rated) / len(rated), 1) if rated else None,
        'kinds': {k: sum(1 for it in items if it.get('kind') == k) for k in KINDS},
    }


def clean(body):
    """보낸 내용 확인. 문제가 있으면 (None, 이유)"""
    if not isinstance(body, dict):
        return None, '형식이 올바르지 않아요'
    kind = body.get('kind') if body.get('kind') in KINDS else 'review'
    rating = body.get('rating')
    try:
        rating = int(rating) if rating not in (None, '') else None
    except (TypeError, ValueError):
        rating = None
    if rating is not None and not 1 <= rating <= 5:
        rating = None
    text = str(body.get('text') or '').strip()[:MAX_TEXT]
    email = str(body.get('email') or '').strip()[:200]
    if email and not EMAIL.match(email):
        return None, '이메일 주소를 확인해 주세요'
    if not text and rating is None:
        return None, '별점이나 내용을 남겨 주세요'
    source = body.get('source') if body.get('source') in ('site', 'extension') else 'site'
    version = re.sub(r'[^0-9.]', '', str(body.get('version') or ''))[:20]
    return {
        'id': uuid.uuid4().hex[:12],
        'at': datetime.now(KST).isoformat(timespec='seconds'),
        'kind': kind,
        'rating': rating,
        'text': text,
        'email': email,
        'source': source,
        'version': version,
    }, None


def limited(ip):
    """최근에 저장된 의견이 너무 많으면 True. 이메일을 잘못 써서 다시 보내는 것은 세지 않는다"""
    now = time.time()
    hits = [t for t in recent.get(ip, []) if now - t < LIMIT[1]]
    recent[ip] = hits
    if len(recent) > 5000:  # 오래 쌓이지 않게
        for k in [k for k, v in recent.items() if not v or now - v[-1] > LIMIT[1]]:
            del recent[k]
    return len(hits) >= LIMIT[0]


class Handler(BaseHTTPRequestHandler):
    server_version = 'uriae-feedback'

    def reply(self, status, obj, cache='no-store'):
        data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', cache)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/api/feedback/summary':
            return self.reply(200, summary(prune(load())), 'public, max-age=300')
        if path == '/api/admin/feedback':
            items = prune(load())
            return self.reply(200, {'summary': summary(items), 'items': items[::-1]})
        self.reply(404, {'error': 'not found'})

    def do_POST(self):
        if self.path.split('?')[0] != '/api/feedback':
            return self.reply(404, {'error': 'not found'})
        size = int(self.headers.get('Content-Length') or 0)
        if size <= 0 or size > MAX_BODY:
            return self.reply(413, {'error': '내용이 너무 길어요'})
        try:
            body = json.loads(self.rfile.read(size).decode('utf-8'))
        except (ValueError, UnicodeDecodeError):
            return self.reply(400, {'error': '형식이 올바르지 않아요'})
        # 사람 눈에 안 보이는 칸을 채웠으면 자동 프로그램. 저장하지 않고 성공한 것처럼 답한다
        if isinstance(body, dict) and body.get('website'):
            return self.reply(200, {'ok': True})
        ip = self.headers.get('X-Real-IP') or self.client_address[0]
        if limited(ip):
            return self.reply(429, {'error': '잠시 후 다시 보내 주세요'})
        item, err = clean(body)
        if err:
            return self.reply(400, {'error': err})
        with open(DATA, 'a', encoding='utf-8') as f:
            f.write(json.dumps(item, ensure_ascii=False) + '\n')
            f.flush()
            os.fsync(f.fileno())
        recent.setdefault(ip, []).append(time.time())
        self.reply(200, {'ok': True})

    def log_message(self, fmt, *args):
        # 접속 기록에 IP 를 남기지 않는다 (nginx 기록만 사용)
        pass


if __name__ == '__main__':
    os.makedirs(os.path.dirname(DATA), exist_ok=True)
    print(f'uriae feedback on {HOST}:{PORT}, data {DATA}', flush=True)
    HTTPServer((HOST, PORT), Handler).serve_forever()
