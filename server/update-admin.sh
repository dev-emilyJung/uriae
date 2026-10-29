#!/bin/sh
# 방문 기록(회전된 압축 기록 포함)으로 통계 파일을 다시 만든다. cron 으로 10분마다 실행.
#  - admin-data.json : 간단한 통계 화면(admin.html)이 읽는 숫자
#  - admin-full.html : GoAccess 전체 보고서 ("자세한 통계")
# 방문자 IP 는 마지막 자리를 지워서(익명화) 집계한다. 관리자 페이지 방문은 빼고 센다.
LOG_DIR=/var/log/nginx
WEB=/var/www/uriae
DATA=$(mktemp)
OPTS="--log-format=COMBINED --anonymize-ip --ignore-crawlers"

zcat -f "$LOG_DIR"/uriae.access.log* 2>/dev/null | grep -v ' "GET /admin' > "$DATA"

if [ -s "$DATA" ] \
  && goaccess "$DATA" $OPTS -o /tmp/uriae-admin.json > /tmp/uriae-goaccess.log 2>&1 \
  && goaccess "$DATA" $OPTS --html-report-title="우리애 한눈에 방문 통계" -o /tmp/uriae-admin-full.html >> /tmp/uriae-goaccess.log 2>&1; then
  mv /tmp/uriae-admin.json "$WEB/admin-data.json"
  mv /tmp/uriae-admin-full.html "$WEB/admin-full.html"
else
  printf '{"general":{"date_time":"%s"}}\n' "$(date '+%Y-%m-%d %H:%M')" > "$WEB/admin-data.json"
fi
rm -f "$DATA"
