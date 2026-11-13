# 배포와 운영

화면은 Vercel, 실시간 서버는 Render, DB는 Neon에 두고, 수집은 국내 회선의 Mac에서 돌린다. 전부 무료이고 결제 수단은 연결하지 않는다. Render와 Vercel은 Neon만 읽는다.

## 운영 주소

- 웹: `https://<web>` (Vercel, Root Directory `apps/web`, 함수 지역 `icn1`)
- 실시간 서버: `https://<realtime>` (Render, singapore, free). 웹소켓은 `wss://<realtime>/ws`
- 수집: Mac의 launchd (`com.traffic-room.collector`). GitHub Actions의 `collect-events`, `collect-cctvs`는 수동 실행용으로만 남겼다

## 환경변수

| 이름 | 넣는 곳 | 값의 모양 | 비밀 |
|---|---|---|---|
| `DATABASE_URL` | Render, Vercel, Mac의 `<저장소>/.env` | `postgres://사용자:비밀번호@호스트/db?sslmode=require` | 예 |
| `ITS_API_KEY` | Mac의 `~/.its-api.env` (Render에는 넣지 않는다) | ITS에서 받은 인증키 문자열 | 예 |
| `ITS_MODE` | Render(`render.yaml`에 `live`로 고정), 수집 스크립트(`live`로 고정) | `live` 또는 `fixture` | 아니오 |
| `COLLECT_INTERVAL_MINUTES` | Mac의 `.env`, Vercel, Render (없으면 60) | 교통 수집 간격(분), 양의 정수. Render는 지표 갱신 주기, Vercel은 "수집 중단" 판정, `/insights` 격자, "N분마다 수집" 표시에 쓴다. 수집 쪽과 같은 값이어야 한다 | 아니오 |
| `DELAY_MINUTES` | Mac의 `.env`, Vercel, Render (없으면 60) | 화면에 보이는 교통 상태를 실제보다 늦추는 분. 수집 쪽과 화면 쪽이 같은 값이어야 한다 | 아니오 |
| `ITS_MONTHLY_LIMIT` | Mac의 `.env` (없으면 950) | 서비스별 월 호출 상한. 이 건수에 닿으면 수집을 멈춘다 | 아니오 |

ITS 한도 상향 승인을 받은 뒤에는 `COLLECT_INTERVAL_MINUTES`, `DELAY_MINUTES`, `ITS_MONTHLY_LIMIT`를 Mac `.env`, Vercel, Render에 함께 설정한다(Vercel과 Render는 앞의 두 값만 읽는다).
| `CCTV_REFRESH` | Render(`render.yaml`에 `off`로 고정) | `on` 또는 `off`. 비워 두면 `ITS_MODE=live`일 때만 켜진다 | 아니오 |
| `ALLOWED_ORIGINS` | Render | `https://<web>`를 쉼표로 구분해 나열. 미리보기 주소가 필요하면 함께 적는다 | 아니오 |
| `NEXT_PUBLIC_REALTIME_URL` | Vercel | `wss://<realtime>/ws` | 아니오 |
| `PORT` | Render가 주입 | 직접 넣지 않는다 | 아니오 |

`NEXT_PUBLIC_` 값은 빌드 때 번들에 박힌다. 바꾸면 Vercel을 다시 배포해야 한다. 웹과 실시간 서버는 ITS를 부르지 않으므로 `ITS_API_KEY`를 Vercel에도 Render에도 넣지 않는다.

## 수집 주기와 월 예산

ITS는 서비스별로 월 1,000건까지 부를 수 있다. 수집기와 실시간 서버는 이번 달 호출이 950건 이상이면 호출을 멈춘다.

| 서비스 | 주기 | 월 사용량 |
|---|---|---|
| 돌발상황(events) | 매시 5분 | 744 |
| 교통소통(traffic) | 매시 5분 | 744 |
| CCTV 목록(cctv) | 0시, 8시, 16시의 5분 | 목록 종류(ex, its)마다 93, 합쳐 186 |

실시간 서버의 CCTV 주소 새로고침은 꺼 두어(`CCTV_REFRESH=off`) ITS 호출이 없다. 목록 수집만 186건이라 한도 안이다. 한도에 가까워지면 ITS 마이페이지의 서비스별 집계로 확인한다.

### 교통소통 수집

교통소통(`traffic`)은 호출 한 번에 전국 노드링크 속도 파일(약 75MB)을 내려받고 20초쯤 걸린다. 고속도로 본선 구간만 골라 `traffic_snapshots`에 쓰고, 검증(구간 수 급감, 속도 범위, 같은 `createdDate`)을 통과하지 못하면 기존 스냅샷을 그대로 둔다. 도로 모양(`highways.json`)에 없는 고속도로 이름 구간은 `unknown`으로 세어 실행 결과에 남긴다. 2026-11-13 기준 약 5,900개였다. 이 수가 크게 늘면 노드링크 파일을 다시 받아 `pnpm highways:build`를 돌려 도로 모양을 갱신한다.

### 설정값

| 이름 | 기본값 | 설명 |
|---|---|---|
| `COLLECT_INTERVAL_MINUTES` | 60 | 교통 수집 간격. 스크립트의 같은 회차 중복 방지 간격(최소 간격)이 이 값 × 60 × 0.5초로 따라간다(60분이면 1,800초, 15분이면 450초) |
| `DELAY_MINUTES` | 60 | 화면에 보이는 교통 상태를 늦추는 분 |
| `ITS_MONTHLY_LIMIT` | 950 | 서비스별 월 호출 상한 |

세 값은 `<저장소>/.env`에 있으면 스크립트가 `read_var`로 읽어 수집기에 넘긴다. 없거나 양의 정수가 아니면 기본값을 쓴다.

### 회선 사용량

호출 한 번이 약 75MB라서 간격에 비례해 늘어난다.

| 간격 | 월 호출 | 월 내려받기 |
|---|---|---|
| 60분 | 약 744 | 약 56GB |
| 15분 | 약 2,976 | 약 220GB |

15분 간격은 월 호출이 `ITS_MONTHLY_LIMIT`(950)를 넘는다. 그대로 두면 월 중반에 수집이 멈추므로, 간격을 줄이려면 ITS 쪽 호출 한도와 회선 약관을 먼저 확인하고 한도 값도 함께 정한다.

### 간격을 15분으로 바꿀 때

승인을 받은 뒤 아래를 함께 바꾼다.

1. 수집용 복사본 `.env`에 `COLLECT_INTERVAL_MINUTES=15`, `DELAY_MINUTES`, `ITS_MONTHLY_LIMIT` 세 줄을 넣는다.
2. plist의 `StartCalendarInterval`을 아래 배열로 바꾼다(5, 20, 35, 50분). 그 뒤 `bootout`, `bootstrap`을 다시 한다.

   ```xml
   <key>StartCalendarInterval</key>
   <array>
     <dict><key>Minute</key><integer>5</integer></dict>
     <dict><key>Minute</key><integer>20</integer></dict>
     <dict><key>Minute</key><integer>35</integer></dict>
     <dict><key>Minute</key><integer>50</integer></dict>
   </array>
   ```

3. Vercel과 Render의 환경변수 `DELAY_MINUTES`를 같은 값으로 맞추고 다시 배포한다.

실시간 서버는 DB를 30분에 한 번만 조회한다. Neon 컴퓨트가 5분 유휴 후 자동으로 멈추게 두려는 것이다.

## 수집은 국내 회선의 Mac에서

ITS(`openapi.its.go.kr:9443`)는 클라우드와 데이터센터 IP의 접속을 받지 않는다. GitHub Actions(미국)와 Vercel `icn1`(AWS 서울)에서 진단 요청을 보냈을 때 둘 다 시간 초과였고, 집 회선의 Mac에서는 정상 응답했다. 도시교통정보센터(UTIC)는 IP 등록이 필요하고 고속도로 CCTV를 다루지 않아 대안이 되지 못했다. 그래서 수집만 Mac에서 돌리고, Render와 Vercel은 Neon만 읽는다. CCTV 영상 호스트(`cctvsec.ktict.co.kr`)는 클라우드와 브라우저에서 모두 닿으므로 재생에는 영향이 없다.

`scripts/collect-local.sh`가 `~/.its-api.env`의 `ITS_API_KEY`와 `<저장소>/.env`의 `DATABASE_URL`을 읽어 돌발상황과 교통소통을 수집한다. 0시, 8시, 16시에는 CCTV 목록도 함께 수집하고, `--cctvs`를 주면 시각과 상관없이 수집한다. 결과는 한 줄씩 `~/Library/Logs/traffic-room-collector.log`에 쌓인다. 키와 접속 문자열은 출력하지 않는다.

### 설치

실제로 처음 등록했을 때 저장소가 `~/Desktop` 아래에 있어서 launchd가 띄운 bash가 스크립트를 읽지 못했다("Operation not permitted"). 바탕화면·문서·다운로드는 macOS가 따로 보호하는 폴더라서다. bash에 전체 디스크 접근 권한을 주는 대신, 수집 전용 복사본을 보호 폴더 밖에 두고 그 복사본을 돌린다.

1. 수집 전용 복사본을 만들고 수집기 의존성만 설치한다.

   ```sh
   APP="$HOME/Library/Application Support/traffic-room/app"
   git clone https://github.com/byeonsejun/traffic-room.git "$APP"
   cd "$APP" && pnpm install --frozen-lockfile --filter "@traffic-room/collector..."
   ```

2. `~/.its-api.env`에 `ITS_API_KEY=...` 한 줄을 두고, 복사본에 `.env`(`DATABASE_URL`)를 권한 600으로 둔다.

   ```sh
   install -m 600 <작업 저장소>/.env "$APP/.env"
   ```

3. 먼저 점검만 한다. 경로와 환경 파일을 확인하고 어떤 작업이 돌지 보여 줄 뿐, 수집은 하지 않는다.

   ```sh
   "$APP/scripts/collect-local.sh" --dry-run
   ```

4. 템플릿의 자리표시자를 복사본 경로로 바꿔 LaunchAgents에 두고 등록한다.

   ```sh
   sed -e "s#__REPO__#$APP#g" -e "s#__HOME__#$HOME#g" \
     "$APP/scripts/launchd/com.traffic-room.collector.plist" \
     > ~/Library/LaunchAgents/com.traffic-room.collector.plist
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.traffic-room.collector.plist
   ```

5. 등록과 마지막 실행 결과를 본다. 바로 돌려 보려면 `kickstart`를 쓴다.

   ```sh
   launchctl print gui/$(id -u)/com.traffic-room.collector
   launchctl kickstart gui/$(id -u)/com.traffic-room.collector
   tail ~/Library/Logs/traffic-room-collector.log
   ```

수집 코드를 고친 뒤에는 복사본도 갱신해야 한다: `cd "$APP" && git pull --ff-only && pnpm install --frozen-lockfile --filter "@traffic-room/collector..."`.

같은 시각에 두 번 도는 것은 스크립트가 막는다. 잠금 디렉터리(`~/Library/Application Support/traffic-room/collect.lock`)가 잡혀 있으면 `SKIP locked`, 직전 성공이 최소 간격(수집 간격의 절반, 기본 30분) 안이면(CCTV 목록은 같은 8시간 구간이면) `SKIP recent`로 기록하고 넘어간다. `--cctvs`는 CCTV 목록 기록을, `--traffic`은 교통소통 기록을, `--force`는 두 기록을 무시한다. 30분 넘은 잠금은 낡은 것으로 보고 넘겨받는다.

### 멈추려면

```sh
launchctl bootout gui/$(id -u)/com.traffic-room.collector
```

plist를 고쳤을 때도 `bootout` 뒤에 다시 `bootstrap`한다.

### Mac이 잠들거나 꺼져 있으면

수집이 멈춘다. 화면은 마지막으로 수집한 데이터를 그대로 보여 주고, 상단 바의 "마지막 수집" 시각이 그대로 머문다. 3시간이 넘으면 날짜와 함께 "수집 일시 중지"로 바뀌어 실시간 데이터처럼 보이지 않는다. 잠든 사이 놓친 예약은 launchd가 깨어난 뒤 한 번만 돌려 준다. 놓친 시간만큼 여러 번 돌지는 않으므로 그 사이의 돌발상황은 다음 수집 때 현재 상태로 따라잡는다. 완전히 꺼져 있었다면 부팅 후 다음 정각 5분에 이어진다.

## 처음 배포할 때

1. Neon 연결 문자열을 로컬 `.env`에 넣고 `pnpm db:migrate`를 돌려 테이블 8개를 만든다.
2. 위 "수집은 국내 회선의 Mac에서"대로 설치하고 `scripts/collect-local.sh --cctvs`를 한 번 직접 돌려 이벤트와 CCTV 목록을 채운다.
3. Render에서 Blueprint로 저장소를 연결하고 `DATABASE_URL`, `ALLOWED_ORIGINS`를 입력한다. `https://<realtime>/health`가 `{"ok":true}`를 돌려주는지 확인한다.
4. Vercel에서 Root Directory를 `apps/web`으로 import하고 `DATABASE_URL`, `NEXT_PUBLIC_REALTIME_URL`을 넣는다. 함수 지역이 `icn1`인지 Settings에서 본다.
5. 나온 Vercel 도메인을 Render의 `ALLOWED_ORIGINS`에 추가한다. 이 값이 비어 있거나 도메인이 빠지면 서버는 모든 브라우저 접속을 거절한다.
6. `https://<web>/maplibre-gl-worker.mjs`가 200을 돌려주는지 확인한다. 지도 워커 파일이라 404면 지도가 뜨지 않는다.
7. cron-job.org에서 `https://<realtime>/health`를 10분마다 GET하게 해 서버가 잠들지 않도록 한다.
8. 웹을 열어 "실시간 연결됨"과 CCTV 재생, 크게 보기를 확인한다.

## 2차(교통 속도) 배포 순서

순서를 바꾸면 안 된다.

1. `pnpm db:migrate`로 새 테이블과 제약을 먼저 만든다.
2. main에 push한다. Vercel과 Render가 배포한다.
3. Mac의 수집용 복사본을 갱신한다: `cd "$APP" && git pull --ff-only && pnpm install --frozen-lockfile --filter "@traffic-room/collector..."`.
4. `scripts/collect-local.sh --traffic`을 한 번 직접 돌린다.
5. 로그에서 `traffic ok …` 줄을 확인한다.

마이그레이션 전에 수집기를 먼저 돌리면 check 제약 위반(코드 23514)으로 실패한다.

## 장애가 났을 때 확인 순서

앞단에서 가까운 원인부터 본다.

1. Mac의 `~/Library/Logs/traffic-room-collector.log`. 수집이 실패했는지, 예산 때문에 건너뛰었는지(`skipped-budget`) 한 줄 요약으로 나온다. 오류는 코드만 남고 접속 정보는 나오지 않는다. 로그가 오래 멈춰 있으면 Mac이 잠들었거나 `launchctl print`에서 등록이 빠졌는지 본다.
2. `collector_runs` 테이블. 서비스별 이번 달 호출 수와 마지막 성공 시각을 본다. 950건 근처라면 예산 문제다.
3. Render 로그. 시작 직후 `DATABASE_URL`이나 `ALLOWED_ORIGINS` 오류가 나왔는지, 스케줄러의 이벤트 조회 실패 로그가 반복되는지 본다. 무료 서비스가 잠들었다 깨는 중이면 첫 응답이 늦다.
4. 브라우저 콘솔. 웹소켓이 연결 직후 정책 위반(코드 1008, origin not allowed)으로 닫히면 `ALLOWED_ORIGINS`에 지금 주소가 없는 것이다. `NEXT_PUBLIC_REALTIME_URL`이 `wss://`로 시작하는지도 본다.

새 돌발이 파동으로 오지 않을 때는 그 시간에 새 상황이 없었을 수 있다. `event_log`에서 예정 건수를 먼저 확인한다.
