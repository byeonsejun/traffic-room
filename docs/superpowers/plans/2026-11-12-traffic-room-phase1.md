# 전국 도로 상황실 1차 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ITS 실제 돌발상황을 1시간 지연으로 WebSocket에 흘려보내고, 어두운 지도 · 실시간 피드 · CCTV 생방송(전체화면 포함)으로 보여 주는 관제 화면 1차를 배포한다.

**Architecture:** GitHub Actions 수집기가 매시 ITS를 조회해 이전 스냅샷과 비교한 결과(도착 · 해제 이벤트와 송출 시각)를 Neon에 쓴다. Render의 Fastify 실시간 서버는 30분마다 다가올 이벤트를 읽어 타이머로 송출하고, WebSocket으로 브로드캐스트 · 재연결 따라잡기 · CCTV 주소 요청을 처리한다. Vercel의 Next.js 화면은 Neon 스냅샷(REST)으로 먼저 그리고, WebSocket이 붙으면 실시간으로 넘어간다.

**Tech Stack:** pnpm workspace · TypeScript · Next.js 16 (App Router) · React 19 · MapLibre GL 6 + OpenFreeMap · hls.js 1.7 · zustand 5 · Fastify 5 + @fastify/websocket 11 · zod 4 · @neondatabase/serverless 1.2 · PGlite(테스트용 Postgres) · Vitest 5

**Spec:** `docs/superpowers/specs/2026-11-12-traffic-room-design.md` (이 계획은 9장 "1차" 범위만 구현한다. 속도 도로선 · SSE 지표 · 차트는 2차, 타임라인 · WebRTC는 3차 계획에서 다룬다.)

## Global Constraints

- Node 24, pnpm 12. 패키지 버전 하한: next 16.4, maplibre-gl 6.18, hls.js 1.7, fastify 5.12, @fastify/websocket 11.3, zod 4.6, zustand 5.1, @neondatabase/serverless 1.2, vitest 5.1.
- 비용 0원. 결제 수단 연결이 필요한 서비스나 설정은 쓰지 않는다.
- ITS 엔드포인트 `https://openapi.its.go.kr:9443`. **서비스별 월 1,000건**. 수집기와 실시간 서버는 서비스별 이번 달 호출 수가 **950 이상이면 호출하지 않는다**.
- 호출 주기: 돌발 매시 5분(`5 * * * *`), CCTV 8시간마다(`15 */8 * * *`, 고속도로 `type=ex`와 국도 `type=its` 각 1회). CCTV는 반드시 `cctvType=4`(HTTPS HLS).
- ITS 키는 환경변수 `ITS_API_KEY`로만 읽는다. 로그 · 에러 메시지 · 응답에 키나 키가 들어간 URL을 절대 남기지 않는다. 로컬 키 파일은 `~/.its-api.env`이고 저장소에 넣지 않는다.
- 개발 · 테스트는 `ITS_MODE=fixture`(기본값)로 `packages/its/fixtures/`의 실제 응답을 쓴다. `ITS_MODE=live`는 배포 환경에서만 쓴다.
- 지연 시간 `DELAY_MINUTES = 60`. 화면에는 늘 "약 1시간 지연"을 표시한다. 가짜 이벤트는 만들지 않는다.
- Neon 무료 컴퓨트 한도(월 100 CU-시간 기준으로 잡음)를 지키려고, 실시간 서버는 DB를 **30분에 한 번**만 정기 조회한다(5분 유휴 시 자동 정지되게 둔다).
- 디자인 토큰: `--asphalt #0C131D`, `--panel #111B28`, `--line #1D2A3A`, `--ink #DCE4EE`, `--mute #7C8A9B`, `--flow #2BD47D`, `--slow #F5B83D`, `--jam #FF4D4F`, `--info #5AA9FF`. 글꼴 IBM Plex Sans KR, 숫자는 `font-variant-numeric: tabular-nums`. 대문자 라벨, 모노스페이스 데이터 라벨, 버튼 끝 화살표는 쓰지 않는다.
- 화면 문구는 한국어 평서문이다. 같은 행동은 같은 이름을 쓴다("크게 보기" ↔ "작게 보기").
- `prefers-reduced-motion: reduce`이면 파동 · 등장 애니메이션을 끈다. 키보드 포커스가 보여야 한다. 1100px 이하에서는 세로 배치로 바꾼다.
- 커밋: `feat:`/`fix:`/`docs:`/`chore:` + 한국어 제목, 본문 2~5줄(왜 · 무엇을 확인했는지), 마지막 줄 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **ITS가 실패하거나 0건을 돌려준 시간** — 4001(한도), 네트워크 오류, 빈 응답일 때 진행 중 상황 전체가 "해제"되면 안 된다. 수집을 중단하고 기존 상태를 유지해야 한다. → Task 4 `plan.test.ts`의 `throws EmptyFetchError` · `run.test.ts`의 `keeps state when ITS fails`.
2. **서버가 잠든 상태의 첫 방문** — WebSocket이 1분 가까이 안 붙어도 스냅샷 화면이 그려지고 "서버를 깨우는 중"이 보여야 한다. → Task 7 `realtime-client.test.ts`의 `reports waking after 5s`.
3. **재연결 뒤 중복 · 역순 이벤트** — resume 응답과 브로드캐스트가 겹쳐도 같은 이벤트가 두 번 쌓이거나 카운터가 두 번 오르면 안 된다. → Task 7 `store.test.ts`의 `ignores duplicate and older ids`.
4. **오래 숨겨 둔 탭으로 돌아왔을 때** — 밀린 이벤트가 한꺼번에 파동 수십 개를 터뜨리면 안 된다. 2분 넘게 지난 이벤트는 조용히 반영만 해야 한다. → Task 7 `store.test.ts`의 `marks stale arrivals as not fresh`.
5. **비정상 원본 데이터** — `startDate`가 빈 값이거나 `0000` 형태, 좌표 0 · 누락, 메시지에 `<사고>::` 접두어가 있어도 파싱이 죽지 않아야 한다. 좌표 없는 항목은 버린다. → Task 2 `normalize.test.ts`의 `tolerates broken rows`.

---

## File Structure

```
traffic-room/
├─ package.json · pnpm-workspace.yaml · tsconfig.base.json · vitest.workspace.ts · .env.example
├─ packages/
│  ├─ shared/src/        incident.ts(타입·분류) · messages.ts(봉투·zod) · index.ts
│  ├─ its/src/           client.ts(fetch·fixture) · normalize.ts(원본→Incident/Cctv) · index.ts
│  │   fixtures/         events.json · cctv-ex.json (2026-11-11 실제 응답)
│  └─ db/src/            schema.sql · db.ts(Db 어댑터) · repo.ts(조회·쓰기) · migrate.ts · test-db.ts(PGlite)
├─ apps/
│  ├─ collector/src/     plan.ts(비교 규칙) · run-events.ts · run-cctvs.ts · budget.ts
│  ├─ realtime/src/      scheduler.ts · hub.ts · server.ts · cctv-refresh.ts · main.ts
│  └─ web/
│     ├─ src/app/        layout.tsx · page.tsx · globals.css · api/snapshot/route.ts · api/cctvs/route.ts
│     ├─ src/lib/        realtime-client.ts · geo.ts · tokens.ts
│     ├─ src/store/      console.ts
│     ├─ src/components/ Console.tsx · TopBar.tsx · ConnectionBadge.tsx · StatsPanel.tsx · MapView.tsx · CctvPanel.tsx · Feed.tsx
│     └─ public/         map-style.json
├─ scripts/build-map-style.mjs
├─ render.yaml
└─ .github/workflows/    ci.yml · collect-events.yml · collect-cctvs.yml
```

## 공유 타입 (모든 Task가 이 이름을 쓴다)

```ts
// packages/shared/src/incident.ts
export type Category = 'accident' | 'breakdown' | 'weather' | 'construction' | 'report' | 'other';
export interface Incident {
  key: string; category: Category; roadName: string; direction: string;
  detail: string; message: string; lanesBlocked: string;
  lon: number; lat: number; startedAt: string | null; // ISO, KST 원본을 +09:00으로 해석
}
export interface Cctv { id: string; name: string; lon: number; lat: number; url: string; fetchedAt: string }
export interface LogEvent { id: number; kind: 'arrived' | 'cleared'; emitAt: string; incident: Incident }

// packages/shared/src/messages.ts — zod 스키마와 z.infer 타입을 함께 export
// 봉투: { id: number; type; ts: string; payload }  (id 0 = 재전송 대상 아님)
ServerMessage =
  | { type: 'hello'; payload: { delayMinutes: number; latestId: number } }
  | { type: 'incident.arrived'; payload: { incident: Incident } }   // id = LogEvent.id
  | { type: 'incident.cleared'; payload: { key: string } }          // id = LogEvent.id
  | { type: 'cctv.url'; payload: { cctvId: string; url: string | null; reason: 'cached' | 'refreshed' | 'unavailable' } }
  | { type: 'pong'; payload: {} }
ClientMessage =
  | { type: 'ping' } | { type: 'resume'; lastId: number } | { type: 'cctv.request'; cctvId: string; refresh: boolean }
export const DELAY_MINUTES = 60;
export function parseServerMessage(raw: string): ServerMessage | null;  // 잘못된 JSON·스키마는 null
export function parseClientMessage(raw: string): ClientMessage | null;
```

---

### Task 1: 모노레포 뼈대와 공유 메시지 스키마

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.workspace.ts`, `.env.example`, `.github/workflows/ci.yml`
- Create: `packages/shared/package.json`, `packages/shared/src/{incident,messages,index}.ts`
- Test: `packages/shared/src/messages.test.ts`

**Interfaces:**
- Produces: 위 "공유 타입" 전부(`@traffic-room/shared`).

- [ ] **Step 1: 워크스페이스 구성.** 루트 스크립트 `test`(`vitest run`), `typecheck`(`pnpm -r typecheck`), `lint`(`pnpm -r lint`). 워크스페이스 `packages/*`, `apps/*`. `.env.example`에는 `ITS_MODE=fixture`, `ITS_API_KEY=`, `DATABASE_URL=`, `ALLOWED_ORIGINS=http://localhost:3000`, `NEXT_PUBLIC_REALTIME_URL=ws://localhost:8787/ws` 이름만 둔다. `ci.yml`은 push · PR에서 `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`.
- [ ] **Step 2: 실패하는 테스트 작성** — `messages.test.ts`

```ts
test('parses a valid arrival envelope', () => {
  const m = parseServerMessage(JSON.stringify({ id: 12, type: 'incident.arrived', ts: '2026-11-11T23:00:00+09:00',
    payload: { incident: sampleIncident } }));
  expect(m?.type).toBe('incident.arrived');
});
test('returns null for broken json or unknown type', () => {
  expect(parseServerMessage('{')).toBeNull();
  expect(parseServerMessage(JSON.stringify({ id: 1, type: 'nope', ts: 'x', payload: {} }))).toBeNull();
});
test('client resume requires a non-negative integer', () => {
  expect(parseClientMessage(JSON.stringify({ type: 'resume', lastId: -1 }))).toBeNull();
  expect(parseClientMessage(JSON.stringify({ type: 'resume', lastId: 40 }))).toEqual({ type: 'resume', lastId: 40 });
});
```

- [ ] **Step 3:** `pnpm test packages/shared` → FAIL(모듈 없음)
- [ ] **Step 4: 구현.** `incident.ts`, `messages.ts`를 "공유 타입" 그대로 만든다. ServerMessage는 `z.discriminatedUnion('type', …)`로 만든다.
- [ ] **Step 5:** `pnpm test packages/shared && pnpm typecheck` → PASS
- [ ] **Step 6: 커밋** `chore: pnpm 모노레포와 실시간 메시지 스키마 추가`

---

### Task 2: ITS 클라이언트와 원본 정규화

**Files:**
- Create: `packages/its/src/{client,normalize,index}.ts`, `packages/its/fixtures/{events.json,cctv-ex.json}`
- Test: `packages/its/src/normalize.test.ts`, `packages/its/src/client.test.ts`

**Interfaces:**
- Consumes: `Incident`, `Cctv`, `Category` (Task 1)
- Produces:
  - `normalizeEvents(raw: unknown): Incident[]`
  - `normalizeCctvs(raw: unknown, fetchedAt: Date): Cctv[]`
  - `categorize(eventType: string, detail: string, message: string): Category`
  - `incidentKey(row: { linkId: string; startDate: string; eventDetailType: string; coordX: number | string; coordY: number | string; roadName: string }): string` — sha1 앞 16자
  - `createItsClient(opts: { mode: 'fixture' | 'live'; apiKey?: string; fetchImpl?: typeof fetch }): ItsClient`
  - `interface ItsClient { events(): Promise<Incident[]>; cctvs(type: 'ex' | 'its', bbox?: Bbox): Promise<Cctv[]> }`, `type Bbox = { minX: number; maxX: number; minY: number; maxY: number }`
  - `class ItsError extends Error { code: string }` — 키 없는 메시지만 담는다.

- [ ] **Step 1: 픽스처 복사.** 2026-11-11에 받은 실제 응답을 복사한다. 돌발: `$CLAUDE_JOB_DIR/tmp/ev.json` → `events.json`, CCTV: `cctv4.json` → `cctv-ex.json`. 파일이 없으면 `ITS_MODE=live`로 돌발 1회 · CCTV(type=ex, 수도권 bbox `127.0,127.2,37.3,37.5`) 1회만 호출해 저장한다(월 한도의 0.2%). CCTV 주소는 만료돼도 괜찮다.
- [ ] **Step 2: 실패하는 테스트 작성**

```ts
test('normalizes the real 2026-11-11 snapshot', () => {
  const list = normalizeEvents(fixture('events.json'));
  expect(list).toHaveLength(284);
  expect(new Set(list.map(i => i.key)).size).toBe(284);
  expect(list.filter(i => i.category === 'construction').length).toBeGreaterThan(200);
});
test('categorize remaps citizen pothole reports out of accident', () => {
  expect(categorize('교통사고', '', '<사고>::[국토교통부 도로안심ㆍ서비스 국민참여단] 포트홀이 발생하였습니다.')).toBe('report');
  expect(categorize('기타돌발', '고장', '(갓길) 화물차 고장처리중')).toBe('breakdown');
  expect(categorize('기타돌발', '장애물', '(2차로) 장애물 처리중')).toBe('breakdown');
  expect(categorize('재난', '강풍', '"강풍"주의')).toBe('weather');
  expect(categorize('공사', '작업', '노면보수')).toBe('construction');
  expect(categorize('교통사고', '추돌', '1차로 추돌사고')).toBe('accident');
});
test('tolerates broken rows', () => {
  const list = normalizeEvents({ header: { resultCode: 0 }, body: { items: [
    { ...row, startDate: '' }, { ...row, startDate: '0000' }, { ...row, coordX: '', coordY: '' }, { ...row, coordX: 0, coordY: 0 },
    { ...row, message: '<사고>::포트홀' } ] } });
  expect(list).toHaveLength(3);                 // 좌표 없음·0 은 버림
  expect(list[0].startedAt).toBeNull();
  expect(list[2].message).toBe('포트홀');        // '<사고>::' 접두어 제거
});
test('startDate is read as KST', () => {
  expect(normalizeEvents(one({ startDate: '20261111225344' }))[0].startedAt).toBe('2026-11-11T13:53:44.000Z');
});
test('cctv list keeps https urls only', () => {
  const list = normalizeCctvs(fixture('cctv-ex.json'), new Date('2026-11-11T14:00:00Z'));
  expect(list).toHaveLength(172);
  expect(list.every(c => c.url.startsWith('https://'))).toBe(true);
});
// client.test.ts
test('live client throws ItsError without leaking the key on 4001', async () => {
  const c = createItsClient({ mode: 'live', apiKey: 'SECRETKEY', fetchImpl: fakeFetch({ header: { resultCode: 4001, resultMsg: '사용량 제한' } }) });
  await expect(c.events()).rejects.toMatchObject({ code: '4001' });
  await c.events().catch(e => expect(String(e.message) + String(e.stack)).not.toContain('SECRETKEY'));
});
test('fixture mode never calls fetch', async () => {
  const f = vi.fn(); await createItsClient({ mode: 'fixture', fetchImpl: f }).events(); expect(f).not.toHaveBeenCalled();
});
```

- [ ] **Step 3:** `pnpm test packages/its` → FAIL
- [ ] **Step 4: 구현.**
  - 분류 규칙: 메시지에 `국민참여단` 또는 `포트홀`이 있으면 `report`. 그 밖에 `공사`/`작업` → construction, `교통사고` → accident, `고장`·`장애물`·`낙하물` → breakdown, `재난`·`기상`·`강풍`·`강설`·`결빙`·`안개` → weather, 나머지 → other.
  - 돌발 응답은 `{header, body:{items}}`, CCTV 응답은 `{response:{data}}` 형태다.
  - live 호출 URL: `/eventInfo?type=all&eventType=all&getType=json`, `/cctvInfo?type={ex|its}&cctvType=4&minX=124&maxX=132&minY=33&maxY=39&getType=json` (bbox 인자가 오면 그 값). fetch 타임아웃 20초.
  - `resultCode`가 0이 아니거나 HTTP 오류면 `ItsError(code)`를 던진다.
  - Cctv.id는 `sha1(name|coordx|coordy)` 앞 16자다.
- [ ] **Step 5:** `pnpm test packages/its` → PASS
- [ ] **Step 6: 커밋** `feat: ITS 돌발·CCTV 응답 정규화와 화면용 분류 추가`

---

### Task 3: DB 스키마와 저장소 함수

**Files:**
- Create: `packages/db/src/{schema.sql,db.ts,repo.ts,migrate.ts,test-db.ts,index.ts}`
- Test: `packages/db/src/repo.test.ts`

**Interfaces:**
- Consumes: `Incident`, `Cctv`, `LogEvent` (Task 1)
- Produces:
  - `interface Db { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> }`
  - `createNeonDb(url: string): Db`, `createTestDb(): Promise<Db>`(PGlite + schema.sql 적용)
  - `getActiveIncidents(db, now: Date): Promise<Incident[]>` — 해제되지 않았고 `arrive_at`이 null이거나 `<= now`인 것
  - `getActiveKeys(db): Promise<string[]>` — 해제되지 않은 전부(도착 예정 포함)
  - `applyIncidentPlan(db, plan: IncidentPlan, collectedAt: Date): Promise<void>` — 한 트랜잭션
  - `getEventsAfter(db, afterId: number, until: Date, limit: number): Promise<LogEvent[]>`
  - `getEventsBetween(db, from: Date, to: Date): Promise<LogEvent[]>`
  - `latestEmittedId(db, now: Date): Promise<number>`
  - `lastCollectedAt(db, service: 'events' | 'cctv'): Promise<Date | null>`
  - `recordRun(db, service: 'events' | 'cctv', ok: boolean, count: number, at: Date): Promise<void>`
  - `countRunsThisMonth(db, service, now: Date): Promise<number>` — 성공·실패 모두 셈(한도는 호출 수 기준), 월 경계는 KST
  - `canCall(db, service: 'events' | 'cctv', now: Date): Promise<boolean>` — `countRunsThisMonth < 950` (수집기와 실시간 서버가 함께 씀)
  - `upsertCctvs(db, list: Cctv[]): Promise<void>`, `getCctvs(db): Promise<Cctv[]>`, `getCctv(db, id: string): Promise<Cctv | null>`, `updateCctvUrl(db, id: string, url: string, at: Date): Promise<void>`
  - `type IncidentPlan = { quiet: Incident[]; arriving: { incident: Incident; emitAt: Date }[]; seen: string[]; cleared: { key: string; emitAt: Date }[] }`

- [ ] **Step 1: 실패하는 테스트 작성** (`createTestDb()`로 실제 SQL을 돌린다)

```ts
test('arriving incident is hidden from snapshot until its emit time', async () => {
  await applyIncidentPlan(db, { quiet: [], arriving: [{ incident: a, emitAt: t('23:50') }], seen: [], cleared: [] }, t('23:05'));
  expect(await getActiveIncidents(db, t('23:10'))).toHaveLength(0);
  expect(await getActiveIncidents(db, t('23:51'))).toHaveLength(1);
});
test('log ids are increasing and events are returned in emit order', async () => { /* arrived 2건 → getEventsAfter(0, …) 순서·id 검증 */ });
test('cleared incident leaves the snapshot after its emit time', async () => { /* cleared emitAt 이후 getActiveIncidents 에서 빠짐 */ });
test('countRunsThisMonth resets at the KST month boundary', async () => {
  await recordRun(db, 'events', true, 1, new Date('2026-11-30T15:30:00Z')); // KST 12-01 00:30
  expect(await countRunsThisMonth(db, 'events', new Date('2026-12-01T03:00:00Z'))).toBe(1);
  expect(await countRunsThisMonth(db, 'events', new Date('2026-11-30T14:00:00Z'))).toBe(0);
});
```

- [ ] **Step 2:** `pnpm test packages/db` → FAIL
- [ ] **Step 3: 구현.** 테이블은 네 개다.
  - `incidents(key pk, category, road_name, direction, detail, message, lanes_blocked, lon, lat, started_at, first_seen_at, last_seen_at, arrive_at null, cleared_at null)`
  - `event_log(id bigserial pk, kind, incident_key fk, emit_at)` + index(emit_at)
  - `collector_runs(id, service, ran_at, ok, count)`
  - `cctvs(id pk, name, lon, lat, url, fetched_at)`

  `applyIncidentPlan`의 동작:
  - `quiet` → insert(arrive_at null)
  - `arriving` → insert(arrive_at = emitAt) + log 'arrived'
  - `seen` → last_seen_at 갱신
  - `cleared` → cleared_at = emitAt + log 'cleared'
  - 이미 있는 key의 insert는 무시(on conflict do nothing)

  `migrate.ts`는 `DATABASE_URL`에 schema.sql을 멱등하게 적용한다(`create … if not exists`). 루트 스크립트 `db:migrate`.
- [ ] **Step 4:** `pnpm test packages/db` → PASS
- [ ] **Step 5: 커밋** `feat: 돌발상황 스냅샷과 송출 로그 저장소 추가`

---

### Task 4: 수집기(비교 규칙 · 실행 · 한도 보호 · GitHub Actions)

**Files:**
- Create: `apps/collector/src/{plan,run-events,run-cctvs}.ts`, `.github/workflows/{collect-events,collect-cctvs}.yml`
- Test: `apps/collector/src/plan.test.ts`, `apps/collector/src/run.test.ts`

**Interfaces:**
- Consumes: `ItsClient`(Task 2), 저장소 함수 · `IncidentPlan` · `canCall`(Task 3), `DELAY_MINUTES`(Task 1)
- Produces:
  - `planIncidentChanges(input: { activeKeys: string[]; fetched: Incident[]; collectedAt: Date; prevCollectedAt: Date | null; delayMinutes: number }): IncidentPlan`
  - `class EmptyFetchError extends Error`
  - `runEvents(deps: { db: Db; its: ItsClient; now: () => Date }): Promise<{ status: 'ok' | 'skipped-budget' | 'failed'; arrived: number; cleared: number }>`
  - `runCctvs(deps): Promise<{ status: 'ok' | 'skipped-budget' | 'failed'; count: number }>`

- [ ] **Step 1: 실패하는 테스트 작성** — `plan.test.ts`

```ts
const at = (hm: string) => new Date(`2026-11-11T${hm}:00+09:00`);
test('first run makes everything quiet', () => {
  const p = planIncidentChanges({ activeKeys: [], fetched: [a, b], collectedAt: at('23:05'), prevCollectedAt: null, delayMinutes: 60 });
  expect(p.quiet).toHaveLength(2); expect(p.arriving).toHaveLength(0); expect(p.cleared).toHaveLength(0);
});
test('new incident started after the previous run arrives at startedAt + 60m', () => {
  const p = planIncidentChanges({ activeKeys: [], fetched: [{ ...a, startedAt: at('22:29').toISOString() }],
    collectedAt: at('23:05'), prevCollectedAt: at('22:05'), delayMinutes: 60 });
  expect(p.arriving[0].emitAt).toEqual(at('23:29'));
});
test('new but long-running incident stays quiet', () => { /* startedAt 2026-09-18 → quiet */ });
test('new incident with null startedAt arrives at collectedAt + 60m', () => { /* emitAt === at('00:05') 다음날 */ });
test('emitAt is never earlier than collectedAt', () => { /* startedAt 21:55, prev 22:05(Actions 지연), collected 23:05 → emitAt >= 23:05 */ });
test('missing active key is cleared at collectedAt + 60m and present ones are seen', () => { /* … */ });
test('throws EmptyFetchError when ITS returns nothing but we have active incidents', () => {
  expect(() => planIncidentChanges({ activeKeys: ['k1'], fetched: [], collectedAt: at('23:05'), prevCollectedAt: at('22:05'), delayMinutes: 60 }))
    .toThrow(EmptyFetchError);
});
```

  `run.test.ts` (createTestDb + 가짜 ItsClient):

```ts
test('keeps state when ITS fails', async () => {
  /* 1회차 ok(2건) → 2회차 its.events() 가 ItsError('4001') → status 'failed', getActiveKeys 그대로 2건, recordRun ok=false 1건 */
});
test('skips without calling ITS when 950 calls were already made this month', async () => { /* its.events 미호출, status 'skipped-budget' */ });
test('runCctvs fetches ex and its once each and upserts', async () => { /* cctvs 호출 2회, recordRun 2건 */ });
```

- [ ] **Step 2:** `pnpm test apps/collector` → FAIL
- [ ] **Step 3: 구현.**
  - "새로 시작됨" 판정은 `startedAt > prevCollectedAt - 5분`이다(Actions 스케줄 지연 여유).
  - `runEvents`의 순서: `canCall` → `its.events()` → `planIncidentChanges` → `applyIncidentPlan` → `recordRun`. ITS 오류나 EmptyFetchError가 나면 `recordRun(ok=false)`만 하고 status 'failed'를 돌려준다. 종료 코드는 1이고, 로그에는 code만 남긴다.
  - 진입점 `pnpm --filter collector events` / `cctvs`는 `ITS_MODE`, `ITS_API_KEY`, `DATABASE_URL` 환경변수로 실행한다.
- [ ] **Step 4:** `pnpm test apps/collector` → PASS
- [ ] **Step 5: 워크플로 작성.**
  - `collect-events.yml`: cron `5 * * * *` + `workflow_dispatch`. Node 24, pnpm 설치 후 `pnpm --filter collector events`, env는 secrets `ITS_API_KEY`, `DATABASE_URL`와 `ITS_MODE: live`.
  - `collect-cctvs.yml`: cron `15 */8 * * *`, 같은 구성.
  - 두 파일 모두 마지막 job에 `gautamkrishnar/keepalive-workflow@v2`(API 방식, 커밋을 만들지 않음)를 둬서 60일 비활성 정지를 막는다.
- [ ] **Step 6: 커밋** `feat: 매시 돌발상황 수집기와 API 한도 보호 추가`

---

### Task 5: 실시간 서버 — 송출 스케줄러

**Files:**
- Create: `apps/realtime/src/scheduler.ts`
- Test: `apps/realtime/src/scheduler.test.ts`

**Interfaces:**
- Consumes: `LogEvent`(Task 1), `getEventsBetween`(Task 3)
- Produces: `createScheduler(opts: { loadWindow: (from: Date, to: Date) => Promise<LogEvent[]>; emit: (e: LogEvent) => void; now: () => Date; windowMinutes: number; reloadMinutes: number }): { start(): Promise<void>; stop(): void }`

- [ ] **Step 1: 실패하는 테스트 작성** (`vi.useFakeTimers()`)

```ts
test('emits each event at its emitAt, once', async () => { /* 두 이벤트 +10분, +20분 → 시간 진행 후 emit 순서·횟수 1 */ });
test('reloads every 30 minutes and does not double-schedule ids it already has', async () => { /* loadWindow 가 겹치는 목록을 돌려줘도 emit 1회 */ });
test('does not emit events whose emitAt passed before start (they are resume-only)', async () => { /* emitAt < now 시작 시점 → emit 0 */ });
test('a failing loadWindow is retried on the next reload without crashing', async () => { /* 첫 load reject → 다음 주기 정상 */ });
```

- [ ] **Step 2:** FAIL 확인 → **Step 3:** 구현(id별 타이머 Map, `windowMinutes=60`, `reloadMinutes=30`, emit 후 Map에서 제거) → **Step 4:** PASS
- [ ] **Step 5: 커밋** `feat: DB 기준 송출 시각으로 이벤트를 내보내는 스케줄러 추가`

---

### Task 6: 실시간 서버 — WebSocket 허브 · CCTV 요청 · 서버 조립

**Files:**
- Create: `apps/realtime/src/{hub,cctv-refresh,server,main}.ts`
- Test: `apps/realtime/src/server.test.ts`

**Interfaces:**
- Consumes: 메시지 파서(Task 1), `ItsClient`(Task 2), 저장소 · `canCall`(Task 3), `createScheduler`(Task 5)
- Produces:
  - `buildServer(deps: { db: Db; its: ItsClient; now: () => Date; allowedOrigins: string[] }): Promise<FastifyInstance>` — 라우트 `GET /health` → `{ ok: true }`, `GET /ws`
  - `hub.broadcast(e: LogEvent): void`
  - `refreshCctv(deps, cctvId: string): Promise<{ url: string | null; reason: 'cached' | 'refreshed' | 'unavailable' }>` — 하루(KST) 10회 상한(메모리 카운터) + `canCall('cctv')`

- [ ] **Step 1: 실패하는 테스트 작성** (`app.injectWS`, createTestDb, 가짜 ItsClient)

```ts
test('sends hello with delay and latest id on connect', async () => { /* 첫 메시지 type 'hello', payload.delayMinutes 60 */ });
test('resume returns missed events after lastId in order, max 200', async () => { /* log 3건, resume lastId=1 → id 2,3 */ });
test('responds pong to ping', async () => {});
test('rejects connections from origins not in ALLOWED_ORIGINS', async () => { /* Origin: https://evil.example → 연결 거부(close 1008) */ });
test('ignores malformed client messages without closing', async () => { /* '{' 전송 후 ping → pong 정상 */ });
test('cctv.request refresh=false returns cached url', async () => {});
test('cctv.request refresh=true calls ITS once with a ±0.01 bbox and updates the url', async () => { /* its.cctvs 1회, reason 'refreshed' */ });
test('cctv refresh returns unavailable after 10 refreshes today', async () => { /* 11번째 its 미호출, url null */ });
test('broadcast reaches every connected client', async () => { /* 클라이언트 2개 → 둘 다 incident.arrived 수신 */ });
```

- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3: 구현.**
  - 클라이언트가 60초 동안 아무것도 보내지 않으면 끊는다(클라이언트 ping 주기 25초).
  - 브로드캐스트 메시지: `{ id: e.id, type: 'incident.arrived' | 'incident.cleared', ts: e.emitAt, payload }`.
  - CCTV 갱신은 대상 좌표 ±0.01 bbox로 `its.cctvs(type)`를 부르고, 응답에서 **이름이 같은** 항목의 주소로 바꾼다(좌표는 미세하게 달라질 수 있어 id로 맞추지 않는다). 성공하든 실패하든 `recordRun('cctv')`를 남긴다.
  - `main.ts`는 `PORT`(기본 8787), `DATABASE_URL`, `ITS_MODE`, `ITS_API_KEY`, `ALLOWED_ORIGINS`(쉼표 구분)를 읽고, 스케줄러의 `emit`을 `hub.broadcast`에 연결한다.
- [ ] **Step 4:** `pnpm test apps/realtime` → PASS
- [ ] **Step 5: 로컬 확인.** `pnpm --filter realtime dev` 실행 후 `curl -s localhost:8787/health` → `{"ok":true}`
- [ ] **Step 6: 커밋** `feat: 재연결 따라잡기와 CCTV 주소 갱신을 지원하는 WebSocket 서버 추가`

---

### Task 7: 웹 — 실시간 클라이언트와 화면 상태

**Files:**
- Create: `apps/web` (Next.js 16 App Router, TypeScript, `src/` 디렉터리, Tailwind 없이 CSS 변수만 사용), `apps/web/src/lib/realtime-client.ts`, `apps/web/src/store/console.ts`
- Test: `apps/web/src/lib/realtime-client.test.ts`, `apps/web/src/store/console.test.ts`

**Interfaces:**
- Consumes: 메시지 타입 · 파서(Task 1)
- Produces:
  - `type ConnStatus = 'connecting' | 'waking' | 'open' | 'retrying'`
  - `createRealtimeClient(opts: { url: string; getLastId: () => number; onMessage: (m: ServerMessage) => void; onStatus: (s: ConnStatus, retryInMs?: number) => void; WebSocketImpl?: typeof WebSocket; random?: () => number }): { send(m: ClientMessage): void; close(): void }`
  - `type Snapshot = { incidents: Incident[]; latestId: number; collectedAt: string | null; delayMinutes: number }`
  - `type FeedItem = { id: number; kind: 'arrived' | 'cleared'; incident: Incident; at: string; fresh: boolean }`
  - `useConsole` (zustand): 상태 `{ incidents: Record<string, Incident>; feed: FeedItem[]; lastId: number; status: ConnStatus; retryInMs?: number; selectedKey: string | null; cctvId: string | null; cctvUrlOverride: Record<string, string> }`, 액션 `applySnapshot(s: Snapshot)`, `applyServerMessage(m: ServerMessage, now: Date)`, `setStatus(s, retryInMs?)`, `select(key: string | null)`, `setCctv(id: string | null)`

- [ ] **Step 1: 앱 생성.** `pnpm create next-app apps/web --ts --app --src-dir --no-tailwind --eslint --use-pnpm --import-alias "@/*"`. vitest + jsdom + @testing-library/react 설정.
- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// realtime-client.test.ts — 가짜 WebSocket 클래스 주입
test('sends resume with the last id on open', () => { /* open → send({type:'resume', lastId: 41}) */ });
test('reports waking after 5s without open', () => { /* advanceTimers(5000) → onStatus('waking') */ });
test('reconnects with capped exponential backoff', () => { /* random=()=>1, 연속 close → 1000, 2000, 4000 … 30000 상한 */ });
test('pings every 25s and reconnects if no pong within 10s', () => {});
test('drops unparseable messages', () => { /* onMessage 미호출 */ });

// console.test.ts
test('applySnapshot fills incidents and lastId', () => {});
test('arrival adds incident, prepends feed (max 30) and advances lastId', () => {});
test('ignores duplicate and older ids', () => { /* id 5 두 번, 그다음 id 4 → feed 1건, incidents 변화 없음 */ });
test('marks stale arrivals as not fresh', () => { /* m.ts 가 now 보다 3분 전 → fresh false, 90초 전 → true */ });
test('clear removes the incident and adds a cleared feed item', () => {});
test('cctv.url updates the override map', () => {});
```

- [ ] **Step 3:** FAIL 확인 → **Step 4:** 구현 → **Step 5:** `pnpm --filter web test` PASS
- [ ] **Step 6: 커밋** `feat: 끊김에 강한 실시간 클라이언트와 관제 화면 상태 추가`

---

### Task 8: 웹 — 스냅샷 API · 지도 스타일 · 지도와 돌발 마커

**Files:**
- Create: `apps/web/src/app/api/snapshot/route.ts`, `apps/web/src/app/api/cctvs/route.ts`, `scripts/build-map-style.mjs`, `apps/web/public/map-style.json`, `apps/web/src/components/MapView.tsx`, `apps/web/src/lib/tokens.ts`
- Test: `apps/web/src/app/api/snapshot/route.test.ts`

**Interfaces:**
- Consumes: `getActiveIncidents`, `latestEmittedId`, `lastCollectedAt`, `getCctvs`(Task 3), `useConsole`(Task 7)
- Produces:
  - `GET /api/snapshot` → `Snapshot` (`revalidate = 60`)
  - `GET /api/cctvs` → `Cctv[]` (`revalidate = 3600`)
  - `<MapView />` — 스토어의 incidents · feed를 읽어 그리고, 클릭하면 `select(key)`
  - `categoryColor(c: Category): string` (tokens.ts: accident→jam, breakdown→slow, weather→info, construction→`#4B5D74`, report→`#7C8A9B`, other→mute)

- [ ] **Step 1: 실패하는 테스트 작성** — route 함수를 createTestDb로 직접 호출

```ts
test('snapshot excludes incidents scheduled to arrive later', async () => {});
test('snapshot returns 503 with a Korean message when the DB is unreachable', async () => {
  /* body.message === '상황 정보를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.' */
});
```

- [ ] **Step 2:** FAIL → **Step 3:** 라우트 구현(Neon은 서버에서만 생성, `DATABASE_URL`은 서버 전용) → **Step 4:** PASS
- [ ] **Step 5: 지도 스타일 생성.** `scripts/build-map-style.mjs`는 `https://tiles.openfreemap.org/styles/dark`를 받아 색만 바꿔 `public/map-style.json`으로 저장한다.
  - 배경 `#0C131D`, 물 `#0A1018`, 육지 `#101A27`, 일반도로 `#16212F`, 고속도로 `#1F2F45`, 라벨 `#7C8A9B`, 라벨 외곽 `#0C131D`.
  - 라벨 필드는 `coalesce(name:ko, name)`.
  - 건물 · POI 레이어는 지운다.
  - 실행해서 나온 파일을 커밋한다. 이후에는 정적 파일로만 쓴다.
- [ ] **Step 6: MapView 구현.**
  - 초기 범위는 남한 bbox `[124.5, 33.0, 131.0, 38.7]`, 상호작용은 이동 · 확대만 둔다.
  - GeoJSON 소스 `incidents`에 레이어 두 개를 둔다. `incidents-halo`는 반경 14, 투명도 0.18, category 색이고, `incidents-core`는 반경 4.5다. 공사는 core 반경 3, 투명도 0.6으로 낮춘다.
  - `feed[0].fresh`가 true인 도착이면 그 좌표에 DOM 마커를 띄운다. CSS 파동(0→46px, 1.4초, 3회)이 끝나면 지우고, 동시에 지도를 그 지점으로 `easeTo`(1.2초)한다.
  - `prefers-reduced-motion`이면 파동과 이동 애니메이션 없이 core만 갱신한다.
  - 점 클릭 · Enter → `select(key)`.
- [ ] **Step 7: 브라우저 확인.** `pnpm --filter web dev`(픽스처를 넣은 로컬 DB 또는 Neon 개발 브랜치) → 남한 지도 위에 돌발 점 280여 개, 공사 점이 다른 유형보다 흐리게 보이면 통과. 스크린샷을 남긴다.
- [ ] **Step 8: 커밋** `feat: 어두운 지도 위에 돌발상황과 도착 파동 표시`

---

### Task 9: 웹 — CCTV 패널과 전체화면

**Files:**
- Create: `apps/web/src/lib/geo.ts`, `apps/web/src/components/CctvPanel.tsx`
- Test: `apps/web/src/lib/geo.test.ts`, `apps/web/src/components/CctvPanel.test.tsx`

**Interfaces:**
- Consumes: `useConsole`(selectedKey, cctvId, cctvUrlOverride, setCctv)(Task 7), `/api/cctvs`(Task 8), 실시간 클라이언트 `send`(Task 7 — Console에서 context로 내려 줌)
- Produces:
  - `distanceKm(a: [number, number], b: [number, number]): number` (haversine)
  - `nearestCctvs(point: [number, number], list: Cctv[], n: number): Cctv[]`
  - `<CctvPanel cctvs={Cctv[]} send={(m: ClientMessage) => void} />`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('nearestCctvs picks the closest by great-circle distance', () => {
  /* 경부선 고장 지점(127.171, 36.790) 근처 목록에서 거리순 3개 */
});
test('fullscreen button falls back to an overlay when the API is missing, and Esc closes it', async () => {
  /* document.fullscreenEnabled=false → 버튼 '크게 보기' 클릭 → 컨테이너 class 'is-overlay', 버튼 '작게 보기', Escape → 해제 */
});
test('on fatal playback error it asks the server for a fresh url once', async () => {
  /* hls.js mock 에서 fatal ERROR 2번 → send({type:'cctv.request', refresh:true}) 1번만 */
});
test('shows guidance when no url is available', () => {
  /* override 에 null → '이 CCTV 영상을 지금 불러올 수 없어요. 다른 CCTV를 골라 보세요.' */
});
```

- [ ] **Step 2:** FAIL → **Step 3: 구현.**
  - 선택된 돌발이 없으면 수도권 기본 CCTV `[경부선] 서초`를 재생한다. 선택되면 가까운 3대를 칩으로 보여 주고 첫 번째를 재생한다.
  - `Hls.isSupported()`가 아니면 `video.src`로 직접 재생한다(Safari).
  - 전체화면은 `container.requestFullscreen()`을 쓰고, `fullscreenchange`로 버튼 문구를 동기화한다.
  - 영상 아래에 CCTV 이름을 둔다. 영상 위에는 "실시간" 표시만 둔다(영상 자체에 글자가 찍혀 있어 겹치지 않게).
- [ ] **Step 4:** PASS
- [ ] **Step 5: 브라우저 확인.** 실제 Neon의 CCTV 주소로 재생 → "크게 보기" → 화면 전체 → Esc. 크롬과 사파리에서 각각 확인한다.
- [ ] **Step 6: 커밋** `feat: 돌발 지점 근처 CCTV 생방송과 크게 보기 추가`

---

### Task 10: 웹 — 상단 바 · 지표 · 피드 · 전체 배치

**Files:**
- Create: `apps/web/src/components/{Console,TopBar,ConnectionBadge,StatsPanel,Feed}.tsx`, `apps/web/src/app/{page.tsx,layout.tsx,globals.css}`
- Test: `apps/web/src/components/ConnectionBadge.test.tsx`, `apps/web/src/components/Feed.test.tsx`

**Interfaces:**
- Consumes: Task 7~9 전부
- Produces: 완성된 `/` 페이지

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test.each([
  ['connecting', '연결하는 중'],
  ['waking', '서버를 깨우는 중이에요. 최대 1분 걸려요'],
  ['open', '실시간 연결됨'],
])('badge text for %s', (s, text) => {});
test('retrying shows seconds until the next attempt', () => { /* retryInMs 4000 → '4초 뒤 다시 연결해요' */ });
test('clicking a feed card selects the incident', () => {});
test('cleared items read as resolved', () => { /* '해제' 표시와 흐린 색 */ });
```

- [ ] **Step 2:** FAIL → **Step 3: 구현.**
  - 그리드는 `270px 1fr 360px` / `56px 1fr`이고, 1100px 이하에서는 지도 → CCTV → 피드 → 지표 순서로 세로 배치한다.
  - 상단 바: "전국 도로 상황실" · 연결 배지 · "약 1시간 지연" · 시계(초 단위).
  - 지표: 진행 중 돌발 수(큰 숫자, 도착 시 1.2초 동안 `--jam`색) + 유형별 막대(CSS).
  - 피드: 카드 등장 애니메이션(위에서 14px, 0.7초)은 `fresh`일 때만 쓴다.
  - Console이 마운트되면 `/api/snapshot` · `/api/cctvs`를 불러와 `applySnapshot`하고, 이어서 `createRealtimeClient(NEXT_PUBLIC_REALTIME_URL)`로 연결한다.
- [ ] **Step 4:** PASS
- [ ] **Step 5: 브라우저 확인.** realtime 서버를 끈 채 페이지를 연다 → 지도 · 피드가 스냅샷으로 뜨고 배지가 "서버를 깨우는 중"으로 바뀌는지 확인한다. 서버를 켜면 "실시간 연결됨"으로 바뀌어야 한다. 키보드 Tab으로 피드 · 칩 · 크게 보기 버튼에 포커스가 보이는지 본다. macOS "동작 줄이기"를 켜고 파동이 멈추는지 확인한다. 1440px와 390px 스크린샷을 남긴다.
- [ ] **Step 6: 커밋** `feat: 관제 화면 배치와 연결 상태·실시간 피드 완성`

---

### Task 11: 배포와 운영 연결

**Files:**
- Create: `render.yaml`, `docs/deploy.md`
- Modify: `apps/realtime/package.json`(build/start), `apps/web/next.config.ts`(필요 시)

**Interfaces:**
- Consumes: 전부
- Produces: 운영 주소 3개(웹, 실시간 서버, 수집 워크플로)

이 Task의 계정 생성 · 로그인 · 시크릿 입력은 **사용자가 직접** 한다. 실행자는 각 단계에서 무엇을 어디에 넣는지 안내하고, 사용자의 완료를 확인한 뒤 진행한다.

- [ ] **Step 1: Neon.** 사용자가 Neon 무료 프로젝트를 만들고 연결 문자열을 로컬 `.env`에 넣는다 → `pnpm db:migrate` → 테이블 4개 생성 확인.
- [ ] **Step 2: 첫 수집.** 로컬에서 `ITS_MODE=live`로 `pnpm --filter collector events`와 `cctvs`를 1회씩 실행한다(키는 `~/.its-api.env`에서 읽고, 화면에 출력하지 않는다) → `status: ok`, 돌발 280건 안팎이 quiet로 들어가고 CCTV가 수천 대 들어가는지 확인. 이번 실행은 돌발 1건, CCTV 2건을 쓴다.
- [ ] **Step 3: GitHub.** 사용자가 공개 저장소를 만들고 push한다. Actions 시크릿 `ITS_API_KEY`, `DATABASE_URL`을 등록한다 → `collect-events`를 `workflow_dispatch`로 1회 실행해 성공을 확인한다.
- [ ] **Step 4: Render.** `render.yaml`(free 웹 서비스, `rootDir` 없이 pnpm 빌드, `healthCheckPath: /health`, env `DATABASE_URL`, `ITS_MODE=live`, `ITS_API_KEY`, `ALLOWED_ORIGINS`)로 사용자가 Blueprint를 연결한다 → `curl https://<render>/health` → `{"ok":true}`.
- [ ] **Step 5: Vercel.** 사용자가 프로젝트 루트를 `apps/web`으로 지정해 import하고, env `DATABASE_URL`, `NEXT_PUBLIC_REALTIME_URL=wss://<render>/ws`를 넣는다 → 배포 주소를 Render의 `ALLOWED_ORIGINS`에 추가한다.
- [ ] **Step 6: 깨워 두기.** 사용자가 cron-job.org(무료)에 `https://<render>/health`를 10분마다 GET하는 작업을 만든다.
- [ ] **Step 7: 운영 확인.**
  - 운영 주소를 연다 → 스냅샷 화면 → "실시간 연결됨" → CCTV 재생 · 크게 보기.
  - 다음 정각+5분 수집 뒤 1시간 안에 새 돌발이 파동과 함께 도착하는지 본다(도착이 없으면 그 시간에 새 상황이 없었던 것이다. `event_log`에서 예정 건수를 확인한다).
  - ITS 마이페이지에서 서비스별 사용량이 예산표와 맞는지 본다.
- [ ] **Step 8: `docs/deploy.md` 작성.** 운영 주소, 환경변수 표, 수집 주기와 월 예산, 장애 시 확인 순서(Actions 로그 → `collector_runs` → Render 로그)를 정리한다. → 커밋 `docs: 배포 구성과 운영 점검 순서 정리`
