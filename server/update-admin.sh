#!/bin/sh
# 방문 기록(회전된 압축 기록 포함)으로 admin.html 을 다시 만든다. cron 으로 10분마다 실행.
# 방문자 IP 는 마지막 자리를 지워서(익명화) 집계한다.
set -e
LOG_DIR=/var/log/nginx
OUT=/var/www/uriae/admin.html
TMP="$OUT.tmp"
zcat -f "$LOG_DIR"/uriae.access.log* 2>/dev/null \
  | grep -v ' "GET /admin.html' \
  | goaccess - --log-format=COMBINED --anonymize-ip --ignore-crawlers \
      --html-report-title="우리애 한눈에 방문 통계" -o "$TMP" >/dev/null 2>&1
mv "$TMP" "$OUT"
