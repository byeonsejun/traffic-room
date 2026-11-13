# 전국 도로 상황실 2차 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고속도로 본선 속도선(속도 단계별 빛 흐름), SSE 지표 스트림, 관제 왼쪽 핵심 차트, `/insights` 분석 페이지를 덮어쓰기 저장과 검증 위에 올린다.

**Architecture:** Mac 수집기가 교통소통 전국 응답에서 고속도로 본선만 걸러 메모리에서 검증한 뒤, 통과한 스냅샷만 Neon에 한 트랜잭션으로 쓰고 오래된 것을 지운다. Render 실시간 서버는 30분마다 DB를 읽어 `/sse/metrics`로 지표 상태를 흘리고, Vercel API가 지금 보여 줄 속도와 24시간 요약을 준다. 화면은 MapLibre 레이어로 속도선과 흐름을, ECharts로 차트를 그린다.

**Tech Stack:** pnpm 모노레포, Node 24(type stripping, 상대 import에 `.ts`), TypeScript 7, Vitest 5, oxlint, Next.js 16, MapLibre GL 6, ECharts(새로), zustand, Fastify 5, Neon / PGlite(테스트).

**Spec:** `docs/superpowers/specs/2026-11-13-traffic-room-phase2-design.md` (1차: `2026-11-12-traffic-room-design.md`)

## Global Constraints

- 비용 0원. 결제 수단이 필요한 서비스 · 유료 플랜 금지.
- 키와 DB 접속 문자열은 로그 · 오류 메시지 · 테스트 출력 어디에도 찍지 않는다(1차 규칙). 오류는 `code`나 이름만 남긴다.
- 개발 · 테스트에서 실제 ITS API를 부르지 않는다. 픽스처만 쓴다.
- 속도 단계: 원활 `speed >= 70`, 서행 `40 <= speed < 70`, 정체 `speed < 40` (km/h). 색: 원활 `#2BD47D`, 서행 `#F5B83D`, 정체 `#FF4D4F`, 정보 `#5AA9FF`, 배경 `#0C131D`, 패널 `#111B28`, 선 `#1D2A3A`, 글자 `#DCE4EE`, 보조 `#7C8A9B`.
- 설정값 기본: 수집 간격 60분, 지연 60분, 서비스별 월 한도 950. 환경변수 `COLLECT_INTERVAL_MINUTES`, `DELAY_MINUTES`, `ITS_MONTHLY_LIMIT`.
- 검증 기준: `resultCode = 0`, 본선 구간 수 ≥ 직전 ready의 80%(직전이 없으면 도로 모양 구간 수의 50%), 속도 0~200, 속도 0인 구간 < 5%, `createdDate`가 하나의 값이고 직전보다 새것.
- 보관: ready 스냅샷 최신 3개, 요약 표 26시간, 해제된 지 7일 지난 `incidents`와 그 `event_log`, 30일 지난 `collector_runs`.
- 지어낸 값 금지: 빈 기록 · 오래된 데이터 · 데이터 없는 구간은 그대로 표시한다.
- `prefers-reduced-motion`이면 흐름 · 전환 애니메이션을 끈다.
- 차트: y축 하나, 상태 색은 라벨과 함께, 계열 2개 이상이면 범례, 텍스트는 글자색 토큰, 차트마다 표로 보기.
- 커밋 메시지: `feat:`/`fix:`/`docs:` + 한국어 제목, 본문 2~5줄(왜 · 무엇을 확인했는지), 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **교통 응답이 반쯤 오거나 비어 있음** (네트워크가 중간에 끊김, `items: []`, 구간 수 급감) → DB는 그대로, 화면은 이전 스냅샷 유지. Task 6에 "구간 수 50% 응답은 거부되고 ready 스냅샷 수가 그대로" 테스트.
2. **원천이 아직 안 바뀐 상태로 다시 수집** (같은 `createdDate`) → 새 스냅샷을 쓰지 않고 실행만 기록, 중복 버킷 없음. Task 6에 테스트.
3. **배포 직후 기록이 몇 시간뿐** → 차트는 있는 만큼만, "기록 중 · N/24시간" 표시, "어제 같은 시각" 비교 숨김. Task 13에 테스트.
4. **SSE가 끊긴 채 다음 교통 갱신 시각이 지남** → 마지막 도로 색 유지, 상단 기준 시각이 오래됨으로 노랗게. Task 11에 테스트.
5. **도로 모양에 없는 구간 번호가 응답에 섞임**(노드링크 갱신 전 신규 구간) → 무시하고 수를 실행 결과에 남긴다. Task 6에 테스트.

---

## 파일 구조

```
packages/shared/src/timing.ts          설정값 읽기 (새로)
packages/shared/src/traffic.ts         속도 단계 · 지표 타입 · metrics zod (새로)
packages/highways/                     노드링크 → highways.json 빌드 + 읽기 (새 패키지)
  src/dbf.ts  src/shp.ts  src/tm.ts  src/simplify.ts  src/build.ts  src/read.ts  src/cli.ts
apps/web/public/highways.json          빌드 결과 (커밋)
packages/its/src/client.ts, normalize.ts  traffic() 추가
packages/its/fixtures/traffic.json     실측 응답 일부 (새로)
packages/db/src/schema.sql, traffic-repo.ts (새로), repo.ts  저장 · 정리
apps/collector/src/traffic.ts (새로)   검증 · 요약 (순수 함수)
apps/collector/src/run-traffic.ts (새로)
scripts/collect-local.sh, scripts/launchd/*.plist, docs/deploy.md
apps/realtime/src/metrics.ts (새로), sse.ts (새로), main.ts, server.ts
apps/web/src/app/api/traffic/route.ts, api/insights/route.ts (새로)
apps/web/src/lib/highways.ts, flow.ts, metrics-client.ts (새로)
apps/web/src/store/metrics.ts (새로)
apps/web/src/components/charts/*.tsx (새로), MapView.tsx, StatsPanel.tsx, TopBar.tsx, Console.tsx
apps/web/src/app/insights/page.tsx + components/insights/*.tsx (새로)
```

---

### Task 1: 공유 설정값 · 속도 단계 · 지표 메시지

**Files:**
- Create: `packages/shared/src/timing.ts`, `packages/shared/src/traffic.ts`, 각 `.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  - `type Timing = { intervalMinutes: number; delayMinutes: number; monthlyLimit: number }`
  - `readTiming(env: Record<string, string | undefined>): Timing` — 양의 정수가 아니면 기본값(60, 60, 950).
  - `type SpeedLevel = 'ok' | 'slow' | 'jam'`, `speedLevel(kmh: number): SpeedLevel`
  - `type TrafficSummary = { avgSpeed: number; ok: number; slow: number; jam: number; jamKm: number }`
  - `metricsSchema` (zod)와 `type Metrics = { trafficSnapshotId: number | null; trafficDataAt: string | null; nextTrafficAt: string | null; traffic: TrafficSummary | null; incidents: { total: number; byCategory: Record<Category, number> }; delayMinutes: number; intervalMinutes: number }`
  - `delayLabel(minutes: number): string` — 60 → `'약 1시간 지연'`, 그 밖 → `'약 N분 지연'`.
- `DELAY_MINUTES` 상수는 Task 2에서 사용처를 모두 바꾼 뒤 지운다.

- [ ] **Step 1: 실패하는 테스트**
  - `readTiming({})` → `{ intervalMinutes: 60, delayMinutes: 60, monthlyLimit: 950 }`
  - `readTiming({ COLLECT_INTERVAL_MINUTES: '15', DELAY_MINUTES: '20', ITS_MONTHLY_LIMIT: '2900' })` → `{ 15, 20, 2900 }`
  - `readTiming({ DELAY_MINUTES: '-5', COLLECT_INTERVAL_MINUTES: 'abc' })` → 기본값
  - `speedLevel(70) === 'ok'`, `speedLevel(69.9) === 'slow'`, `speedLevel(40) === 'slow'`, `speedLevel(39) === 'jam'`
  - `delayLabel(60) === '약 1시간 지연'`, `delayLabel(20) === '약 20분 지연'`
  - `metricsSchema.safeParse(valid).success === true`, `traffic: null` 허용
- [ ] **Step 2:** `pnpm vitest run packages/shared` → FAIL
- [ ] **Step 3:** 구현
- [ ] **Step 4:** PASS 확인
- [ ] **Step 5:** 커밋 `feat: 수집 간격 · 지연 · 월 한도 설정값과 속도 단계 정의를 공유 패키지에 추가`

### Task 2: 1차의 고정값을 설정값으로 바꾸기

**Files:**
- Modify: `packages/db/src/repo.ts` (`canCall`에 `limit` 인자, `Service`에 `'traffic'`), `apps/collector/src/run-events.ts`, `apps/collector/src/env.ts`, `apps/web/src/app/api/snapshot/route.ts`, `apps/web/src/components/TopBar.tsx`, `apps/web/src/components/Console.tsx`, `packages/shared/src/messages.ts`(상수 제거, hello의 `delayMinutes`는 유지), `apps/realtime/src/server.ts`(hello에 timing 사용), 관련 테스트

**Interfaces:**
- Consumes: Task 1 `readTiming`, `delayLabel`
- Produces:
  - `canCall(db: Db, service: Service, now: Date, limit: number): Promise<boolean>`
  - `type Service = 'events' | 'cctv' | 'traffic'`
  - `depsFromEnv()`가 `timing: Timing`도 돌려준다. `RunDeps`에 `timing: Timing`.
  - `ServerDeps`에 `timing: Timing`.
  - `TopBar` props에 `delayMinutes: number` (문구는 `delayLabel`).

- [ ] **Step 1: 실패하는 테스트**
  - repo: `canCall(db, 'events', now, 3)`가 이번 달 실행 3건이면 `false`, 2건이면 `true`
  - run-events: `timing.delayMinutes = 20`이면 계획의 송출 시각이 `[collectedAt, collectedAt + 20분]` 안
  - TopBar: `delayMinutes={20}` → "약 20분 지연" 표시, `60` → "약 1시간 지연"
  - snapshot route: `DELAY_MINUTES=20` 환경에서 응답 `delayMinutes === 20`
- [ ] **Step 2:** 해당 테스트 FAIL 확인
- [ ] **Step 3:** 구현. 기존 테스트의 `DELAY_MINUTES` import는 `readTiming({}).delayMinutes`로 바꾼다.
- [ ] **Step 4:** `pnpm test && pnpm typecheck && pnpm lint` 전부 PASS (기존 176개 포함)
- [ ] **Step 5:** 커밋 `feat: 지연 · 월 한도를 설정값으로 바꿔 한도 상향 승인 뒤 숫자만 바꾸면 되게 함`

### Task 3: 노드링크 → `highways.json` 빌드 패키지

**Files:**
- Create: `packages/highways/{package.json,tsconfig.json}`, `src/{dbf,shp,tm,simplify,build,read,cli}.ts`, 각 테스트, `apps/web/public/highways.json`(빌드 결과)
- Modify: 루트 `package.json`에 `"highways:build": "node packages/highways/src/cli.ts"`

**Interfaces:**
- Produces:
  - `readDbf(buf: Uint8Array, fields: string[], decode?: (b: Uint8Array) => string): Iterable<Record<string, string>>` — CP949는 `new TextDecoder('euc-kr')`.
  - `readShpLines(shp: Uint8Array, shx: Uint8Array, index: number): [number, number][]` — 파트는 이어 붙인다.
  - `tmToLonLat(x: number, y: number): [number, number]` — GRS80, lon0 127°, lat0 38°, k0 1.0, FE 200000, FN 600000.
  - `simplify(points: [number, number][], tolerance: number): [number, number][]` — 더글러스-포커, 양 끝점 유지.
  - `buildHighways(dir: string): HighwaysFile` — `ROAD_RANK === '101' && CONNECT === '0'`만, TM 좌표에서 8m로 단순화한 뒤 경위도 소수 4자리.
  - `type HighwaysFile = { source: string; routes: string[]; links: [linkId: string, routeIndex: number, lengthM: number, coords: [number, number][]][] }`
  - `loadHighways(path: string): HighwaysIndex`, `type HighwaysIndex = { size: number; get(linkId: string): { route: string; lengthM: number } | undefined }`
  - CLI: `pnpm highways:build <MOCT_LINK가 있는 폴더> [source 라벨]` → `apps/web/public/highways.json`
- 근거 실측(설계 3장): 본선 링크는 교통 응답과 8,964개가 겹치고, 전체 본선은 그보다 많다. 출력 gzip 목표 500KB 이하.

- [ ] **Step 1: 실패하는 테스트**
  - `tmToLonLat(200000, 600000)` → `[127, 38]` (오차 1e-9)
  - `tmToLonLat(200000, 711000)[0]` → 127 (중앙자오선 위는 경도 그대로), 위도는 38.99~39.01
  - `simplify([[0,0],[1,0.1],[2,0]], 0.5)` → `[[0,0],[2,0]]`, `simplify([[0,0],[1,5],[2,0]], 0.5)` → 3점 그대로
  - `readDbf`: 테스트 안에서 필드 2개(`LINK_ID` C10, `ROAD_NAME` C30), 레코드 2개짜리 DBF 바이트를 만들어 읽기. `ROAD_NAME`에 CP949 "경부고속도로" 바이트를 넣고 디코드 결과 확인.
  - `readShpLines`: 테스트 안에서 PolyLine 레코드 1개(파트 2개, 점 3+2개) SHP/SHX를 만들어 5점이 순서대로 나오는지.
  - `buildHighways`: 위 헬퍼로 만든 링크 3개(본선 · 연결로 · 국도) 폴더 → 본선 1개만, `routes`에 노선 이름.
  - `loadHighways`: `get('미지')` → `undefined`, 알려진 id → `{ route, lengthM }`
- [ ] **Step 2:** `pnpm vitest run packages/highways` FAIL
- [ ] **Step 3:** 구현
- [ ] **Step 4:** PASS
- [ ] **Step 5:** 실제 파일 만들기. `~/Downloads/[2026-11-11]NODELINKDATA.zip`에서 `MOCT_LINK.*`만 임시 폴더에 풀고(저장소 밖) `pnpm highways:build <폴더> 2026-11-11`. 확인: 링크 수 출력, `gzip -c apps/web/public/highways.json | wc -c` ≤ 500,000. 넘으면 단순화 허용 오차를 12m로 올리고 다시.
- [ ] **Step 6:** 커밋 `feat: 표준노드링크에서 고속도로 본선 모양을 뽑는 빌드 도구와 결과 파일 추가` (본문에 링크 수 · 크기 · 기준일)

### Task 4: ITS 교통소통 클라이언트와 픽스처

**Files:**
- Modify: `packages/its/src/client.ts`, `normalize.ts`, 테스트
- Create: `packages/its/fixtures/traffic.json`

**Interfaces:**
- Produces:
  - `ItsClient.traffic(): Promise<TrafficFetch>`
  - `type TrafficFetch = { dataAt: string[]; items: { linkId: string; roadName: string; speed: number }[] }` — `dataAt`은 응답의 서로 다른 `createdDate`를 ISO(KST → UTC)로 바꾼 목록. 검증은 Task 6이 한다.
  - `normalizeTraffic(raw: unknown): TrafficFetch` — `resultCode !== 0`이면 `ItsError('ITS_RESULT', …)`. `speed`가 숫자가 아니면 그 항목을 뺀다.
  - live 호출: `/trafficInfo`, `type=all`, `drcType=all`, 한국 bbox, `getType=json`. 타임아웃은 이 호출만 120초(응답 75MB, 실측 19초).
- 픽스처: `$CLAUDE_JOB_DIR/tmp/trf-kr.json`(2026-11-13 11:00 실측)에서 `roadName`이 "경부고속도로"인 항목 전부 + 고속도로가 아닌 항목 200개를 `{header, body: {totalCount, items}}` 형태로 저장. 1MB 이하. 원본이 없으면 같은 형태로 손으로 만든 소량 픽스처를 쓰고 커밋 본문에 적는다.

- [ ] **Step 1: 실패하는 테스트**
  - fixture 모드 `traffic()` → `items.length > 0`, `dataAt` 길이 1, `dataAt[0] === '2026-11-13T02:00:00.000Z'`(실측 픽스처일 때)
  - `normalizeTraffic({ header: { resultCode: 1 } })` → `ItsError`
  - `speed: ''` 항목은 빠진다
  - live 모드 `fetchImpl` 목: 요청 URL에 `type=all`, `drcType=all`, `minX=124` 포함, 오류 메시지에 `apiKey` 값이 없음
- [ ] **Step 2–4:** FAIL → 구현 → PASS
- [ ] **Step 5:** 커밋 `feat: ITS 교통소통 전국 조회와 실측 픽스처 추가`

### Task 5: 교통 저장소 (스키마 · 덮어쓰기 · 정리)

**Files:**
- Modify: `packages/db/src/schema.sql`, `test-db.ts`(TABLES에 새 표), `index.ts`
- Create: `packages/db/src/traffic-repo.ts`, `traffic-repo.test.ts`

**Interfaces:**
- 스키마(설계 7.3, `status` 열은 두지 않는다. 검증은 쓰기 전에 메모리에서 하고, 통과한 것만 쓴다. Neon HTTP는 대화형 트랜잭션이 없어 이 편이 단순하고 결과가 같다):
  - `traffic_snapshots(id bigserial pk, data_at timestamptz unique, collected_at, show_at, link_count int, avg_speed real, ok int, slow int, jam int, jam_km real)`
  - `link_speeds(snapshot_id bigint references traffic_snapshots on delete cascade, link_id text, speed smallint, primary key(snapshot_id, link_id))`
  - `traffic_buckets(data_at timestamptz pk, avg_speed real, ok int, slow int, jam int, jam_km real)`
  - `route_buckets(data_at timestamptz, route text, avg_speed real, primary key(data_at, route))`
  - `collector_runs` check 제약을 `('events','cctv','traffic')`로: `alter table collector_runs drop constraint if exists collector_runs_service_check; alter table collector_runs add constraint collector_runs_service_check check (...)`
- Produces:
  - `type NewTrafficSnapshot = { dataAt: Date; collectedAt: Date; showAt: Date; summary: TrafficSummary; routes: { route: string; avgSpeed: number }[]; speeds: { linkId: string; speed: number }[] }`
  - `saveTrafficSnapshot(db, s: NewTrafficSnapshot): Promise<number>` — 한 `batch` 안에서 스냅샷 · 속도(unnest 배열 한 문장) · 두 버킷 표를 넣는다. 돌려주는 값은 id.
  - `latestTrafficSnapshot(db): Promise<{ id: number; dataAt: Date; linkCount: number } | null>`
  - `pruneTraffic(db, now: Date): Promise<void>` — ready 최신 3개 밖의 스냅샷 삭제, 버킷은 `data_at < now - 26h` 삭제
  - `pruneHistory(db, now: Date): Promise<void>` — `cleared_at < now - 7d`인 incidents와 그 event_log, `ran_at < now - 30d`인 collector_runs
  - `shownTrafficSnapshot(db, now): Promise<TrafficSnapshotRow | null>`, `type TrafficSnapshotRow = { id: number; dataAt: Date; showAt: Date; summary: TrafficSummary }`
  - `upcomingTrafficSnapshots(db, from: Date, to: Date): Promise<TrafficSnapshotRow[]>` — `show_at`이 (from, to]
  - `getLinkSpeeds(db, snapshotId): Promise<[string, number][]>`
  - `getInsights(db, now): Promise<Insights>`, `type Insights = { buckets: (TrafficSummary & { dataAt: string })[]; routes: { dataAt: string; route: string; avgSpeed: number }[]; incidentsByHour: { hour: string; total: number; byCategory: Record<Category, number> }[] }` — 버킷 26시간, 돌발은 `started_at` 최근 24시간을 시간 단위로.
  - `activeIncidentCounts(db, now): Promise<{ total: number; byCategory: Record<Category, number> }>`

- [ ] **Step 1: 실패하는 테스트** (PGlite)
  - 저장 후 `latestTrafficSnapshot` id · linkCount, `getLinkSpeeds` 길이 일치
  - 스냅샷 5개 저장 → `pruneTraffic` → 남은 id가 최신 3개
  - 버킷 `now-27h`, `now-25h` → prune 후 25h만 남음
  - `shownTrafficSnapshot`: showAt이 과거 · 미래인 두 스냅샷 → 과거 것. 둘 다 미래면 `null`
  - `upcomingTrafficSnapshots(now, now+30m)` 경계: 정확히 `now`인 것은 제외, `now+30m`은 포함
  - `pruneHistory`: 8일 전 해제 사건과 그 로그 삭제, 6일 전 해제 · 진행 중은 유지
  - 같은 `dataAt` 두 번 저장 → 두 번째는 오류(unique), 첫 번째 데이터 그대로
- [ ] **Step 2–4:** FAIL → 구현 → PASS
- [ ] **Step 5:** 커밋 `feat: 교통 스냅샷을 최신 3개만 남기고 덮어쓰는 저장소와 오래된 기록 정리 추가`

### Task 6: 교통 수집 실행 (검증 · 요약)

**Files:**
- Create: `apps/collector/src/traffic.ts`, `traffic.test.ts`, `run-traffic.ts`, `run-traffic.test.ts`
- Modify: `apps/collector/src/run-events.ts`(성공 뒤 `pruneHistory`), `env.ts`(`highways: HighwaysIndex` 추가, 경로 `apps/web/public/highways.json`)

**Interfaces:**
- Consumes: Task 3 `HighwaysIndex`, Task 4 `TrafficFetch`, Task 5 저장 함수, Task 1 `speedLevel`, `Timing`
- Produces:
  - `pickHighways(fetch: TrafficFetch, hw: HighwaysIndex): { speeds: { linkId: string; speed: number }[]; missing: number; unknown: number }` — `hw`에 있는 링크만 남긴다. `missing` = `hw.size - speeds.length`(데이터 없는 본선 수). `unknown` = `roadName`에 "고속도로"가 있는데 `hw`에 없는 항목 수. 연결로가 포함돼 2026-11-13 기준 약 5,900이 기본값이고, 이 수가 크게 늘면 노드링크를 다시 받을 때다(deploy.md에 기록).
  - `validateTraffic(input: { fetch: TrafficFetch; speeds: …; prev: { dataAt: Date; linkCount: number } | null; hwSize: number }): { ok: true; dataAt: Date } | { ok: false; reason: 'result' | 'multi-time' | 'not-newer' | 'too-few' | 'bad-speed' | 'too-many-zero' }`
  - `summarize(speeds, hw): { summary: TrafficSummary; routes: { route: string; avgSpeed: number }[] }` — 평균은 구간 길이 가중 평균, `jamKm`는 정체 구간 길이 합 / 1000, 소수 1자리.
  - `runTraffic(deps: RunDeps & { highways: HighwaysIndex }): Promise<{ status: 'ok' | 'same' | 'rejected' | 'skipped-budget' | 'failed'; links?: number; missing?: number; reason?: string; code?: string }>` — `not-newer`는 `same`(실행만 기록, ok=true), 나머지 검증 실패는 `rejected`(실행 기록 ok=false, count=0). 성공 시 `showAt = dataAt + delayMinutes`, 저장 후 `pruneTraffic`.
  - 진입점 출력 한 줄: `traffic ok links=8964 missing=… data=HH:mm` (키 · URL 없음)

- [ ] **Step 1: 실패하는 테스트**
  - `summarize`: 길이 1000m 속도 100, 길이 3000m 속도 20 → `avgSpeed 40`, `ok 1, jam 1`, `jamKm 3.0`
  - `validateTraffic`: 직전 1000 · 이번 790 → `too-few`, 800 → ok; `dataAt` 2개 → `multi-time`; 직전과 같음 → `not-newer`; 속도 250 → `bad-speed`; 0 속도 5% → `too-many-zero`, 4.9% → ok; 직전 없음 + `hwSize` 1000 · 이번 499 → `too-few`
  - `pickHighways`: 응답에 `hw`에 없는 링크가 섞여도 결과에 없음, `missing` = `hw.size - 남은 수`, "OO고속도로"인데 `hw`에 없는 항목 2개 → `unknown 2`, 국도 항목은 `unknown`에 안 셈
  - 진입점 출력 한 줄에 `unknown=`도 포함
  - `runTraffic`(PGlite + fixture 클라이언트 목): 첫 실행 `ok` 저장 1개; 같은 응답 두 번째 `same`, 스냅샷 1개 그대로, 버킷 1줄 그대로; 구간 절반만 오는 목 → `rejected`, ready 스냅샷 수 그대로; 월 한도 도달 → `skipped-budget`, ITS 호출 0회
  - run-events 성공 뒤 8일 전 해제 사건이 지워짐
- [ ] **Step 2–4:** FAIL → 구현 → PASS
- [ ] **Step 5:** 커밋 `feat: 교통소통 수집을 검증 통과 시에만 저장하도록 추가`

### Task 7: Mac 수집 스크립트 · launchd · 배포 문서

**Files:**
- Modify: `scripts/collect-local.sh`, `scripts/launchd/com.traffic-room.collector.plist`, `docs/deploy.md`, `apps/collector/package.json`(`"traffic": "node src/run-traffic.ts"`)

**Interfaces:**
- 스크립트: `JOBS=(events traffic)` + 기존 CCTV 규칙. `--traffic`로 traffic만 강제. `COLLECT_INTERVAL_MINUTES`, `DELAY_MINUTES`, `ITS_MONTHLY_LIMIT`를 `$DB_ENV`에서 `read_var`로 읽어(없으면 기본) node에 넘긴다. `EVENTS_MIN_GAP_SEC`는 `간격 × 60 × 0.5`로, traffic도 같은 규칙의 스탬프.
- plist: 기본은 지금처럼 매시 5분. 문서에 15분 간격일 때의 `StartCalendarInterval` 배열(5, 20, 35, 50분)을 적는다.
- deploy.md: 교통 수집 · 설정값 표 · 회선 사용량(60분 약 56GB/월, 15분 약 220GB/월) · 노드링크 갱신 시 `pnpm highways:build` 절차 · 승인 뒤 바꿀 값 목록(.env 3개, plist, Vercel/Render 환경변수 `DELAY_MINUTES`).

- [ ] **Step 1:** `bash scripts/collect-local.sh --dry-run` 출력에 "후보 작업: events traffic" 확인(실제 호출 없음)
- [ ] **Step 2:** `.env`에 `COLLECT_INTERVAL_MINUTES=15`를 임시로 넣은 복사 환경에서 dry-run → 최소 간격 450초로 바뀐 것을 출력으로 확인 후 되돌림
- [ ] **Step 3:** `plutil -lint scripts/launchd/com.traffic-room.collector.plist` OK
- [ ] **Step 4:** 커밋 `feat: Mac 수집에 교통소통 작업과 간격 설정을 추가하고 배포 문서를 고침`

### Task 8: 실시간 서버 SSE 지표 스트림

**Files:**
- Create: `apps/realtime/src/metrics.ts`, `metrics.test.ts`, `sse.ts`, `sse.test.ts`
- Modify: `apps/realtime/src/main.ts`, `server.ts`(`ServerDeps`에 `metrics?: MetricsState`), `scheduler.ts`(emit 콜백에서 metrics에도 전달)

**Interfaces:**
- Consumes: Task 5 `shownTrafficSnapshot`, `upcomingTrafficSnapshots`, `activeIncidentCounts`; Task 1 `Metrics`, `Timing`; 1차 `LogEvent`
- Produces:
  - `createMetricsState(deps: { load: () => Promise<{ shown: TrafficSnapshotRow | null; upcoming: TrafficSnapshotRow[]; incidents: Metrics['incidents'] }>; now: () => Date; timing: Timing; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout }): MetricsState`
  - `interface MetricsState { current(): Metrics; reload(): Promise<void>; onEvent(e: LogEvent): void; subscribe(fn: (m: Metrics) => void): () => void; stop(): void }` — `reload`는 upcoming마다 `showAt`에 타이머를 걸어 그 시각에 `traffic` · `trafficSnapshotId` · `trafficDataAt` · `nextTrafficAt`을 바꾸고 구독자에게 알린다. `onEvent`는 arrived +1, cleared −1(카테고리별), 0 아래로 내려가지 않는다.
  - `registerSse(app: FastifyInstance, metrics: MetricsState, allowedOrigins: string[]): void` — `GET /sse/metrics`: Origin이 허용 목록에 없으면 403. 헤더 `content-type: text/event-stream`, `cache-control: no-store`, `access-control-allow-origin: <origin>`. 접속 즉시 `id: n\nevent: metrics\ndata: <json>\n\n`, 이후 변경마다 같은 형식, 25초마다 `: ping\n\n`. 끊기면 구독 해제.
  - main: 스케줄러의 30분 reload와 같은 주기로 `metrics.reload()`(DB 읽기 횟수 그대로).

- [ ] **Step 1: 실패하는 테스트**
  - metrics: shown A(avg 80), upcoming B(showAt now+10m, avg 60) → `current().traffic.avgSpeed === 80`; 가짜 타이머 10분 진행 → 60, 구독자 1회 호출, `nextTrafficAt === null`
  - `onEvent` arrived accident → total +1, byCategory.accident +1; 같은 키 cleared → 원래대로; cleared가 먼저 와도 음수 아님
  - sse(`app.inject`는 스트림이라 실제 `listen` + `fetch` 사용): 허용 Origin 접속 시 첫 청크에 `event: metrics`; `metrics` 변경 시 두 번째 이벤트 id가 1 증가; 비허용 Origin → 403
- [ ] **Step 2–4:** FAIL → 구현 → PASS
- [ ] **Step 5:** 커밋 `feat: 지표 상태를 SSE 로 흘리는 /sse/metrics 추가`

### Task 9: Vercel API — 교통 · 인사이트

**Files:**
- Create: `apps/web/src/app/api/traffic/route.ts`, `route.test.ts`, `apps/web/src/app/api/insights/route.ts`, `route.test.ts`

**Interfaces:**
- Consumes: Task 5 `shownTrafficSnapshot`, `getLinkSpeeds`, `upcomingTrafficSnapshots`, `getInsights`
- Produces:
  - `GET /api/traffic` → `TrafficResponse = { id: number; dataAt: string; nextShowAt: string | null; speeds: [string, number][] } | { id: null }` (`id: null`은 아직 보여 줄 스냅샷이 없음)
  - `GET /api/insights` → `Insights` (Task 5) + `{ delayMinutes, intervalMinutes }`
  - 둘 다 `force-dynamic`, 성공 `s-maxage=60, stale-while-revalidate=30`, 실패 503 `no-store`. DB 없는 로컬은 픽스처: traffic은 Task 4 픽스처를 `highways.json`으로 거른 값, insights는 빈 배열(지어낸 기록 금지).

- [ ] **Step 1: 실패하는 테스트** — PGlite 주입 또는 저장소 목으로: 스냅샷 있을 때 형태 · 헤더, 없을 때 `{ id: null }`, DB 오류 시 503, production + DB 없음 → 503
- [ ] **Step 2–4:** FAIL → 구현 → PASS
- [ ] **Step 5:** 커밋 `feat: 지금 보여 줄 속도와 24시간 요약을 주는 API 추가`

### Task 10: 지도 — 한국 범위 · 바탕선 · 속도선 · 흐름

**Files:**
- Create: `apps/web/src/lib/highways.ts`, `highways.test.ts`, `apps/web/src/lib/flow.ts`, `flow.test.ts`
- Modify: `apps/web/src/components/MapView.tsx`, `MapView.test.tsx`, `apps/web/src/app/globals.css`(범례)

**Interfaces:**
- Consumes: Task 3 `HighwaysFile`(정적 `/highways.json`), Task 9 `TrafficResponse`, Task 1 `speedLevel`
- Produces:
  - `toGeoJson(file: HighwaysFile, speeds: Map<string, number> | null): FeatureCollection` — 속성 `{ s: number | null, lv: 0..4 | null }`, `lv`는 흐름 단계(아래).
  - `FLOW_LEVELS: { maxSpeed: number; dashStepMs: number }[]` — 5단계, 시작값 `[{<20, 0(멈춤)}, {<40, 400}, {<70, 200}, {<100, 110}, {≥100, 70}]`. 화면을 보며 조정 가능.
  - `startFlow(map: Map, levels = FLOW_LEVELS): () => void` — 단계별 레이어 `hw-flow-<i>`의 `line-dasharray`를 단계마다 다른 주기로 순환(MapLibre "animated line" 방식). reduced motion이면 시작하지 않는다.
  - MapView: `maxBounds [[123.5, 32.5], [132.5, 39.3]]`, `minZoom 5.5`, `renderWorldCopies: false`. 레이어 순서: 바탕선(`#1D2A3A`보다 밝은 회색) → 번짐 → 속도선 → 흐름 → 돌발 마커. 두께는 `interpolate zoom`(6 → 1.2px, 10 → 3px). 속도 갱신 시 `line-color-transition` 1500ms(reduced motion이면 0).
  - 범례: 원활 · 서행 · 정체 · 데이터 없음 + `교통 HH:mm 기준`.
- `highways.json`은 지도 `load` 뒤에 가져온다(첫 화면 돌발 마커가 기다리지 않게).

- [ ] **Step 1: 실패하는 테스트**
  - `toGeoJson`: 속도 없는 링크 `s: null, lv: null`; 75km/h → `lv` 3; 15 → 0
  - `startFlow`: 가짜 지도 객체로 reduced motion이면 `setPaintProperty` 호출 0회, 아니면 단계 0은 호출 0회 · 단계 4가 단계 1보다 많이 호출(가짜 시계 2초)
  - MapView 테스트(기존 maplibre 목 확장): 생성 옵션에 `maxBounds`, `minZoom`, `renderWorldCopies:false`
- [ ] **Step 2–4:** FAIL → 구현 → PASS
- [ ] **Step 5: 브라우저 확인** — `pnpm --filter @traffic-room/web dev`(DB 없음 → 픽스처) 후 Playwright로 전국 · 서울 확대(z10) 캡처. 확인: 바탕선 끊김 없음, 연결로 없음, 한국 밖으로 끌어도 멈춤, 흐름이 단계별로 다름(두 프레임 비교). 캡처를 커밋 본문에 설명.
- [ ] **Step 6:** 커밋 `feat: 고속도로 본선을 속도 색과 단계별 흐름으로 그리고 지도를 한국 범위로 묶음`

### Task 11: SSE 클라이언트 · 지표 스토어 · 상단 바

**Files:**
- Create: `apps/web/src/lib/metrics-client.ts`, 테스트, `apps/web/src/store/metrics.ts`, 테스트
- Modify: `apps/web/src/components/TopBar.tsx`, `Console.tsx`(SSE 연결, 교통 스냅샷 id가 바뀌면 `/api/traffic` 다시 받기), 테스트

**Interfaces:**
- Consumes: Task 1 `metricsSchema`, Task 8 이벤트 형식, Task 9
- Produces:
  - `createMetricsClient(opts: { url: string; onMetrics: (m: Metrics) => void; onStatus: (s: 'open' | 'retry') => void; EventSourceImpl?: typeof EventSource }): { close(): void }` — `metrics` 이벤트를 zod로 검증, 실패는 무시.
  - `useMetrics` (zustand): `{ metrics: Metrics | null; apply(m: Metrics): void }`
  - `isTrafficStale(dataAt: string, now: Date, timing: { delayMinutes: number; intervalMinutes: number }): boolean` — `now - dataAt > delay + 2 × interval`
  - TopBar: `trafficDataAt`가 있으면 `교통 HH:mm 기준`, 오래되면 `stale` 클래스(노랑).
  - 환경변수 `NEXT_PUBLIC_REALTIME_URL`(wss://…/ws)에서 SSE 주소를 만든다: `https://…/sse/metrics`.

- [ ] **Step 1: 실패하는 테스트**
  - 가짜 EventSource로 유효 메시지 → `onMetrics` 1회, 깨진 JSON → 0회
  - `isTrafficStale`: 지연 60 · 간격 60, dataAt이 3시간 1분 전 → true, 2시간 59분 → false
  - TopBar: 오래된 dataAt → `.stale` 존재
  - Console: SSE `trafficSnapshotId`가 1 → 2로 바뀌면 `/api/traffic` fetch 2회, 같으면 1회; SSE가 끊겨도 지도 속도 데이터 유지
  - Console: `/api/traffic`이 503 → MapView에 속도 `null`(바탕선만), 범례에 "교통 정보를 불러오지 못했어요", 돌발 피드는 그대로
- [ ] **Step 2–4:** FAIL → 구현 → PASS
- [ ] **Step 5:** 커밋 `feat: SSE 지표를 받아 상단 바에 교통 기준 시각과 오래됨을 표시`

### Task 12: 관제 왼쪽 패널 차트 (ECharts)

**Files:**
- Modify: `apps/web/package.json`(`echarts` 정확한 버전 고정, 설치 시점 최신 안정판), `StatsPanel.tsx`, 테스트
- Create: `apps/web/src/components/charts/EChart.tsx`(공통 래퍼), `charts/theme.ts`, `charts/SpeedTrend.tsx`, `charts/LevelBar.tsx`, 테스트

**Interfaces:**
- Consumes: Task 11 `useMetrics`, Task 9 `Insights.buckets`
- Produces:
  - `EChart({ option, height, ariaLabel, table }: { option: EChartsCoreOption; height: number; ariaLabel: string; table: { columns: string[]; rows: (string | number)[][] } })` — `echarts/core`에 Line · Bar · Heatmap · Grid · Tooltip · VisualMap · Legend · Canvas만 등록. `next/dynamic`(ssr: false)으로 불러온다. "표로 보기" 토글로 `<table>`을 보여 준다. reduced motion이면 `animation: false`.
  - `chartTheme`: 배경 투명, 글자 `#DCE4EE`/`#7C8A9B`, 축선 `#1D2A3A`, 상태 색 토큰.
  - `speedTrendOption(buckets): EChartsCoreOption`, `levelBarOption(summary): EChartsCoreOption` — 순수 함수(테스트 대상)
  - StatsPanel 순서: 평균 속도 큰 숫자 + SpeedTrend(높이 56) → LevelBar(구간 수 라벨) → 진행 중 돌발 + 유형별(1차 그대로) → "분석 보기 →"(`/insights`) → 안내 문구(지연은 `delayLabel`).
  - 기록이 1개 이하면 추이 대신 "기록 중 · N/24시간".

- [ ] **Step 1: 실패하는 테스트** — `speedTrendOption`: 시리즈 1개, y축 1개, 데이터 길이 = 버킷 수, tooltip trigger `axis`; `levelBarOption`: 색이 상태 토큰 순서, 라벨에 구간 수; StatsPanel(EChart 목): traffic null이면 "교통 정보 준비 중", 링크 `href="/insights"`
- [ ] **Step 2–4:** FAIL → 구현 → PASS
- [ ] **Step 5: 브라우저 확인** — 왼쪽 패널 캡처, 번들 확인: `next build` 출력에서 `/` 첫 로드 JS가 ECharts 추가 전보다 80KB(gzip) 넘게 늘지 않음(동적 로딩 확인)
- [ ] **Step 6:** 커밋 `feat: 관제 왼쪽에 평균 속도 추이와 구간 상태 차트 추가`

### Task 13: `/insights` 분석 페이지

**Files:**
- Create: `apps/web/src/app/insights/page.tsx`, `components/insights/{Insights,KpiTiles,RouteHeatmap,SlowRoutes,LevelArea,IncidentHours}.tsx`, `lib/insights.ts`(옵션 빌더 · 계산), 테스트
- Modify: `TopBar.tsx`(관제 · 분석 탭, 현재 경로 강조), `globals.css`

**Interfaces:**
- Consumes: Task 9 `/api/insights`, Task 11 `useMetrics` · SSE, Task 12 `EChart`, `chartTheme`
- Produces (`lib/insights.ts`, 순수 함수):
  - `historyHours(buckets, intervalMinutes): number` — 기록이 덮는 시간(0~24)
  - `yesterdayDelta(buckets, now): number | null` — 24시간 전 ± 간격/2 안의 버킷이 없으면 `null`
  - `heatmapOption(routes, topN = 12)` — 노선은 최근 24시간 평균 기록 수가 많은 순으로 12개, 순차 색 한 계열(느림 어두운 빨강 → 빠름 `#2BD47D`), 셀 툴팁 `노선 · HH:mm · N km/h`
  - `slowRoutesOption(routes, n = 7)` — 가장 최근 `dataAt`의 노선 평균 하위 7개, 막대 색은 `speedLevel`
  - `levelAreaOption(buckets)` — 누적 면 3개(정체 → 서행 → 원활), y축 0~100%, 십자선 툴팁
  - `incidentHoursOption(incidentsByHour)` — 막대, 툴팁에 유형별 수
  - KPI 타일: 평균 속도(+ `yesterdayDelta`가 있으면 "어제 같은 시각보다 ±N"), 정체 길이 km, 진행 중 돌발(사고 · 고장), 다음 교통 갱신까지(`nextTrafficAt` 기준, 1초마다)
- 페이지는 처음 `/api/insights`를 받고, SSE `trafficSnapshotId`가 바뀌면 다시 받는다. 타일은 SSE로 즉시 갱신.
- 기록이 24시간 미만이면 상단에 "기록 중 · N/24시간 — 배포 뒤 쌓이는 중이에요" 띠.

- [ ] **Step 1: 실패하는 테스트**
  - `historyHours`: 60분 간격 버킷 9개 → 9
  - `yesterdayDelta`: 24시간 전 버킷 없음 → `null`, 있으면 차이
  - `heatmapOption`: 노선 20개 입력 → y축 12개, visualMap 하나, 지어낸 칸 없음(데이터 없는 칸은 비움)
  - `slowRoutesOption`: 7개, 오름차순
  - `levelAreaOption`: 시리즈 3개, `stack` 같음, y축 하나
  - 페이지(EChart 목): 기록 9개 → "기록 중 · 9/24시간", 어제 비교 문구 없음
- [ ] **Step 2–4:** FAIL → 구현 → PASS
- [ ] **Step 5: 브라우저 확인** — 앱 안에 가짜 데이터 경로(`?demo` 등)는 만들지 않는다. Playwright `page.route('**/api/insights')`로 24시간치 응답을 주입해 1440×900 · 390×844 캡처: 겹침 · 넘침 · 툴팁 확인, "기록 중" 상태도 한 장.
- [ ] **Step 6:** 커밋 `feat: 노선 × 시간 히트맵 등 24시간 분석 페이지 /insights 추가`

### Task 14: 운영 반영과 문서

**Files:**
- Modify: `README.md`(2차 문단: 속도선 · 덮어쓰기 · 검증 · 분석 페이지, 스크린샷 교체/추가), `docs/screenshots/*`, `.superpowers/HANDOFF.md`(git 밖)

- [ ] **Step 1:** 전체 `pnpm test && pnpm typecheck && pnpm lint` PASS, 테스트 수 기록
- [ ] **Step 2:** Neon에 스키마 적용(`pnpm db:migrate`, 접속 문자열 미출력) 전 사용자 확인을 받는다(운영 DB 변경)
- [ ] **Step 3:** 수집 전용 복사본 갱신(`git pull --ff-only && pnpm install --frozen-lockfile --filter "@traffic-room/collector..."`) → `collect-local.sh --traffic` 한 번 실행 → 로그 한 줄 `traffic ok links=…` 확인
- [ ] **Step 4:** push(운영 배포) 전 사용자 확인 → Vercel · Render 배포 → 운영 화면에서 속도선 · SSE(상단 기준 시각) · `/insights` 캡처
- [ ] **Step 5:** README · 스크린샷 · HANDOFF 갱신, 커밋 `docs: 2차(속도선 · 분석 페이지) 내용을 README 에 반영`
