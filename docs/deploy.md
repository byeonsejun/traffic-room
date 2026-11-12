# 배포와 운영

화면은 Vercel, 실시간 서버는 Render, 수집은 GitHub Actions, DB는 Neon에 둔다. 전부 무료 플랜이고 결제 수단은 연결하지 않는다.

## 운영 주소

- 웹: `https://<web>` (Vercel, Root Directory `apps/web`, 함수 지역 `icn1`)
- 실시간 서버: `https://<realtime>` (Render, singapore, free). 웹소켓은 `wss://<realtime>/ws`
- 수집: GitHub Actions의 `collect-events`, `collect-cctvs`

## 환경변수

| 이름 | 넣는 곳 | 값의 모양 | 비밀 |
|---|---|---|---|
| `DATABASE_URL` | Render, Vercel, Actions 시크릿, 로컬 `.env` | `postgres://사용자:비밀번호@호스트/db?sslmode=require` | 예 |
| `ITS_API_KEY` | Render, Actions 시크릿 | ITS에서 받은 인증키 문자열 | 예 |
| `ITS_MODE` | Render(`render.yaml`에 `live`로 고정), Actions(워크플로에 고정) | `live` 또는 `fixture` | 아니오 |
| `ALLOWED_ORIGINS` | Render | `https://<web>`를 쉼표로 구분해 나열. 미리보기 주소가 필요하면 함께 적는다 | 아니오 |
| `NEXT_PUBLIC_REALTIME_URL` | Vercel | `wss://<realtime>/ws` | 아니오 |
| `PORT` | Render가 주입 | 직접 넣지 않는다 | 아니오 |

`NEXT_PUBLIC_` 값은 빌드 때 번들에 박힌다. 바꾸면 Vercel을 다시 배포해야 한다. 웹은 `ITS_API_KEY`를 쓰지 않으므로 Vercel에 넣지 않는다.

## 수집 주기와 월 예산

ITS는 서비스별로 월 1,000건까지 부를 수 있다. 수집기와 실시간 서버는 이번 달 호출이 950건 이상이면 호출을 멈춘다.

| 서비스 | 주기 | 월 사용량 |
|---|---|---|
| 돌발상황(events) | 매시 5분, `5 * * * *` | 744 |
| CCTV 목록(cctv) | 8시간마다 15분, `15 */8 * * *` | 목록 종류(ex, its)마다 93, 합쳐 186 |
| CCTV 주소 새로고침(cctv) | 실시간 서버, 하루 10건 한도 | 최대 310 |

CCTV 서비스는 목록 수집과 새로고침이 같은 한도를 나눠 쓴다. 최악의 경우에도 496건이라 한도 안이고, 950건에 닿으면 새로고침부터 막힌다. 한도에 가까워지면 ITS 마이페이지의 서비스별 집계로 확인한다.

실시간 서버는 DB를 30분에 한 번만 조회한다. Neon 컴퓨트가 5분 유휴 후 자동으로 멈추게 두려는 것이다. Actions 스케줄은 몇 분씩 늦을 수 있어도 1시간 주기에는 문제가 없다.

## 처음 배포할 때

1. Neon 연결 문자열을 로컬 `.env`에 넣고 `pnpm db:migrate`를 돌려 테이블 4개를 만든다.
2. GitHub 저장소에 `ITS_API_KEY`, `DATABASE_URL` 시크릿을 등록하고 `collect-events`를 `workflow_dispatch`로 한 번 실행한다. 성공하면 `collect-cctvs`도 한 번 실행한다.
3. Render에서 Blueprint로 저장소를 연결하고 `DATABASE_URL`, `ITS_API_KEY`, `ALLOWED_ORIGINS`를 입력한다. `https://<realtime>/health`가 `{"ok":true}`를 돌려주는지 확인한다.
4. Vercel에서 Root Directory를 `apps/web`으로 import하고 `DATABASE_URL`, `NEXT_PUBLIC_REALTIME_URL`을 넣는다. 함수 지역이 `icn1`인지 Settings에서 본다.
5. 나온 Vercel 도메인을 Render의 `ALLOWED_ORIGINS`에 추가한다. 이 값이 비어 있거나 도메인이 빠지면 서버는 모든 브라우저 접속을 거절한다.
6. `https://<web>/maplibre-gl-worker.mjs`가 200을 돌려주는지 확인한다. 지도 워커 파일이라 404면 지도가 뜨지 않는다.
7. cron-job.org에서 `https://<realtime>/health`를 10분마다 GET하게 해 서버가 잠들지 않도록 한다.
8. 웹을 열어 "실시간 연결됨"과 CCTV 재생, 크게 보기를 확인한다.

## 장애가 났을 때 확인 순서

앞단에서 가까운 원인부터 본다.

1. GitHub Actions 로그. 수집이 실패했는지, 예산 때문에 건너뛰었는지(`skipped-budget`) 한 줄 요약으로 나온다. 오류는 코드만 남고 접속 정보는 나오지 않는다.
2. `collector_runs` 테이블. 서비스별 이번 달 호출 수와 마지막 성공 시각을 본다. 950건 근처라면 예산 문제다.
3. Render 로그. 시작 직후 `DATABASE_URL`이나 `ALLOWED_ORIGINS` 오류가 나왔는지, 스케줄러의 이벤트 조회 실패 로그가 반복되는지 본다. 무료 서비스가 잠들었다 깨는 중이면 첫 응답이 늦다.
4. 브라우저 콘솔. 웹소켓이 연결 직후 정책 위반(코드 1008, origin not allowed)으로 닫히면 `ALLOWED_ORIGINS`에 지금 주소가 없는 것이다. `NEXT_PUBLIC_REALTIME_URL`이 `wss://`로 시작하는지도 본다.

새 돌발이 파동으로 오지 않을 때는 그 시간에 새 상황이 없었을 수 있다. `event_log`에서 예정 건수를 먼저 확인한다.
