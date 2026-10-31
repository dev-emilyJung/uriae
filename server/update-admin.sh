#!/bin/sh
# 방문 기록(회전된 압축 기록 포함)으로 통계 파일을 다시 만든다. cron 으로 10분마다 실행.
#  - admin-data.json : 간단한 통계 화면(admin.html)이 읽는 숫자
#  - admin-full.html : GoAccess 전체 보고서 ("자세한 통계")
# 방문자 IP 는 마지막 자리를 지워서(익명화) 집계한다. 관리자 페이지 방문은 빼고 센다.
# 사람 방문만 센다: 화면을 그리려고 style.css 까지 받은 (IP, 브라우저)만 남긴다. 로봇은 보통 HTML만 받는다.
# 본인 방문 빼기: /etc/uriae-admin-exclude 에 IP를 한 줄에 하나씩 (앞부분만 써도 됨, 예: 211.234.). 저장소에는 넣지 않는다.
LOG_DIR=/var/log/nginx
WEB=/var/www/uriae
EXCLUDE=/etc/uriae-admin-exclude
RAW=$(mktemp)
DATA=$(mktemp)
OPTS="--log-format=COMBINED --anonymize-ip --ignore-crawlers"

zcat -f "$LOG_DIR"/uriae.access.log* 2>/dev/null | grep -v ' "GET /admin' > "$RAW"

# COMBINED 형식을 " 로 나누면 $2 요청, $4 리퍼러, $6 브라우저
awk -F'"' -v ex="$EXCLUDE" '
  BEGIN { while ((getline line < ex) > 0) { sub(/[ \t\r]+$/, "", line); if (line != "" && line !~ /^#/) skip[++n] = line } }
  function ip(s) { split(s, a, " "); return a[1] }
  function mine(x,  i) { for (i = 1; i <= n; i++) if (index(x, skip[i]) == 1) return 1; return 0 }
  NR == FNR { if ($2 ~ /^GET \/style\.css/ && $4 !~ /\/admin/) human[ip($1) "|" $6] = 1; next }
  { x = ip($1); if ((x "|" $6) in human && !mine(x)) print }
' "$RAW" "$RAW" > "$DATA"

if [ -s "$DATA" ] \
  && goaccess "$DATA" $OPTS -o /tmp/uriae-admin.json > /tmp/uriae-goaccess.log 2>&1 \
  && goaccess "$DATA" $OPTS --html-report-title="우리애 한눈에 방문 통계" -o /tmp/uriae-admin-full.html >> /tmp/uriae-goaccess.log 2>&1; then
  mv /tmp/uriae-admin.json "$WEB/admin-data.json"
  mv /tmp/uriae-admin-full.html "$WEB/admin-full.html"
else
  printf '{"general":{"date_time":"%s"}}\n' "$(date '+%Y-%m-%d %H:%M')" > "$WEB/admin-data.json"
fi
rm -f "$RAW" "$DATA"
