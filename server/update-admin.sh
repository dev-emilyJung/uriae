#!/bin/sh
# 방문 기록(회전된 압축 기록 포함)으로 admin.html 을 다시 만든다. cron 으로 10분마다 실행.
# 방문자 IP 는 마지막 자리를 지워서(익명화) 집계한다.
# 기록이 아직 없거나 분석에 실패해도 안내 페이지를 만들어서 404 가 나지 않게 한다.
LOG_DIR=/var/log/nginx
OUT=/var/www/uriae/admin.html
TMP=/tmp/uriae-admin.html
DATA=$(mktemp)

zcat -f "$LOG_DIR"/uriae.access.log* 2>/dev/null | grep -v ' "GET /admin.html' > "$DATA"

if [ -s "$DATA" ] && goaccess "$DATA" --log-format=COMBINED --anonymize-ip --ignore-crawlers \
     --html-report-title="우리애 한눈에 방문 통계" -o "$TMP" > /tmp/uriae-goaccess.log 2>&1; then
  mv "$TMP" "$OUT"
else
  printf '<!doctype html><html lang="ko"><meta charset="utf-8"><title>방문 통계</title><body style="font-family:sans-serif;padding:40px;line-height:1.6"><h1>아직 집계할 방문 기록이 없어요</h1><p>%s 기준. 10분마다 다시 확인합니다.</p><p>계속 이 화면이면 서버에서 <code>cat /tmp/uriae-goaccess.log</code> 로 원인을 확인하세요.</p></body></html>' "$(date '+%Y-%m-%d %H:%M')" > "$OUT"
fi
rm -f "$DATA"
