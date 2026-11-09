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

# 어디서 왔나 (admin-sources.json): 홈 화면을 연 방문을 날짜·IP·브라우저마다 한 번씩 나눠 센다
#  - 카톡: 휴대폰 카톡 안 브라우저(브라우저 정보에 KAKAOTALK). PC 카톡은 크롬으로 열려서 "직접"에 섞인다
#  - 검색: 구글·네이버·다음·빙에서 링크를 누름
#  - 다른 사이트 / 직접·알 수 없음(주소 입력, 즐겨찾기, PC 카톡, 앱)
#  - 카톡방에 링크가 올라감(대략): 카카오 미리보기 수집기(kakaotalk-scrap)가 홈을 가져간 횟수. 카카오가 미리보기를 한동안 저장해 두므로 실제보다 적다
awk -F'"' '
  function ip(s) { split(s, a, " "); return a[1] }
  function day(s) { split(s, a, "[\\[:]"); return a[2] }
  function home(r) { return r ~ /^GET \/(index\.html)?([?#][^ ]*)? / }
  NR == FNR {
    if ($6 ~ /kakaotalk-scrap/ && home($2)) { d = day($1); share[d]++; shares++; days[d] = 1 }
    next
  }
  home($2) {
    d = day($1); k = d "|" ip($1) "|" $6
    if (k in seen) next
    seen[k] = 1
    if ($6 ~ /KAKAOTALK/) s = "kakao"
    else if ($4 ~ /^https?:\/\/((www\.)?google\.|([a-z]+\.)?search\.naver\.com|([a-z]+\.)?search\.daum\.net|(www\.)?bing\.com)/) s = "search"
    else if ($4 == "-" || $4 ~ /emilysoft\.com/) s = "direct"
    else s = "other"
    n[s]++; by[d, s]++; days[d] = 1
  }
  END {
    printf "{\"kakao\":%d,\"search\":%d,\"other\":%d,\"direct\":%d,\"shares\":%d,\"days\":[", n["kakao"], n["search"], n["other"], n["direct"], shares
    sep = ""
    for (d in days) {
      printf "%s{\"d\":\"%s\",\"kakao\":%d,\"search\":%d,\"other\":%d,\"direct\":%d,\"shares\":%d}", sep, d, by[d, "kakao"], by[d, "search"], by[d, "other"], by[d, "direct"], share[d]
      sep = ","
    }
    print "]}"
  }
' "$RAW" "$DATA" > /tmp/uriae-admin-sources.json && mv /tmp/uriae-admin-sources.json "$WEB/admin-sources.json"

# 폰에서 PC로 (admin-funnel.json, 2026-11-09): 기기(폰 m · PC pc)마다 홈 방문 · 설치 버튼 · (폰) PC로 보내기·알림 · (PC) 보낸 링크로 다시 옴
#  - 버튼은 홈페이지가 부르는 빈 파일 /e?a=store|send|remind 기록으로 센다 (개인 정보 없음)
#  - 날짜·IP·브라우저마다 한 번씩
awk -F'"' '
  function ip(s) { split(s, a, " "); return a[1] }
  function day(s) { split(s, a, "[\\[:]"); return a[2] }
  function once(k) { if (k in seen) return 0; seen[k] = 1; return 1 }
  {
    k = day($1) "|" ip($1) "|" $6; d = ($6 ~ /Android|iPhone|iPad|iPod|Mobile/) ? "m" : "pc"
    if ($2 ~ /^GET \/(index\.html)?([?#][^ ]*)? /) {
      if (once("h|" k)) n[d, "home"]++
      if ($2 ~ /[?&]from=(pc-send|remind)/ && once("b|" k)) n[d, "back"]++
    } else if (match($2, /^GET \/e\?a=[a-z]+/)) {
      act = substr($2, 10, RLENGTH - 9)
      if (once(act "|" k)) n[d, act]++
    }
  }
  END {
    printf "{"
    split("m pc", D, " "); sep = ""
    for (i = 1; i <= 2; i++) { x = D[i]; printf "%s\"%s\":{\"home\":%d,\"store\":%d,\"send\":%d,\"remind\":%d,\"back\":%d}", sep, x, n[x, "home"], n[x, "store"], n[x, "send"], n[x, "remind"], n[x, "back"]; sep = "," }
    print "}"
  }
' "$DATA" > /tmp/uriae-admin-funnel.json && mv /tmp/uriae-admin-funnel.json "$WEB/admin-funnel.json"

if [ -s "$DATA" ] \
  && goaccess "$DATA" $OPTS -o /tmp/uriae-admin.json > /tmp/uriae-goaccess.log 2>&1 \
  && goaccess "$DATA" $OPTS --html-report-title="우리애 한눈에 방문 통계" -o /tmp/uriae-admin-full.html >> /tmp/uriae-goaccess.log 2>&1; then
  mv /tmp/uriae-admin.json "$WEB/admin-data.json"
  mv /tmp/uriae-admin-full.html "$WEB/admin-full.html"
else
  printf '{"general":{"date_time":"%s"}}\n' "$(date '+%Y-%m-%d %H:%M')" > "$WEB/admin-data.json"
fi
rm -f "$RAW" "$DATA"
