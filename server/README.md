# 서버 설정 (uriae.emilysoft.com)

홈페이지(`site/`)를 nginx 로 띄우고, 본인만 볼 수 있는 방문 통계 페이지(`/admin.html`)를 만든다.
Ubuntu 기준이며 모든 명령은 서버에서 실행한다.

## 1. 홈페이지 올리기

```bash
sudo apt update && sudo apt install -y nginx git
sudo git clone https://github.com/dev-emilyJung/uriae.git /opt/uriae
sudo ln -sfn /opt/uriae/site /var/www/uriae
sudo cp /opt/uriae/server/nginx-uriae.conf /etc/nginx/sites-available/uriae
sudo ln -sf /etc/nginx/sites-available/uriae /etc/nginx/sites-enabled/uriae
sudo nginx -t && sudo systemctl reload nginx
```

HTTPS (웹스토어 개인정보처리방침 주소로 쓰려면 필수):

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d uriae.emilysoft.com
```

이후 홈페이지 수정 반영: `cd /opt/uriae && sudo git pull`

## 2. 관리자 통계 페이지 (/admin.html)

```bash
sudo apt install -y goaccess apache2-utils
# 아이디 admin, 비밀번호는 입력 프롬프트에서 설정
sudo htpasswd -c /etc/nginx/.uriae-admin admin
sudo cp /opt/uriae/server/update-admin.sh /usr/local/bin/uriae-update-admin
sudo /usr/local/bin/uriae-update-admin
# 10분마다 갱신
echo '*/10 * * * * root nice -n 19 ionice -c3 /usr/local/bin/uriae-update-admin' | sudo tee /etc/cron.d/uriae-admin
```

https://uriae.emilysoft.com/admin.html 접속 → 아이디·비밀번호 입력.

볼 수 있는 것: 방문자 수, 페이지별 조회수, 유입 경로(어느 카페·블로그에서 왔는지), 국가, 브라우저, 시간대별 방문.
`/privacy.html` 조회수는 웹스토어 심사·설치 직전 확인으로도 참고할 수 있다.

## 확장 프로그램 사용자 수

확장은 아무 데이터도 보내지 않으므로 여기서는 알 수 없다.
크롬 웹스토어 개발자 대시보드 → 항목 → 통계(주간 사용자, 설치·삭제, 지역·버전)에서 확인한다.
