#!/usr/bin/env bash
# 국내 회선의 Mac 에서 ITS 수집을 돌린다. launchd 가 매시 5분에 부른다(docs/deploy.md).
#   scripts/collect-local.sh            events 수집, 0/8/16시에는 cctvs 도 수집
#   scripts/collect-local.sh --cctvs    시각과 상관없이 cctvs 도 수집
#   scripts/collect-local.sh --force    잠금은 지키되 최근 실행 기록(스탬프)은 무시하고 모두 돌림
#   scripts/collect-local.sh --dry-run  경로·PATH·환경 파일·중복 실행 방지를 점검만 하고 pnpm 은 돌리지 않음
# 키와 접속 문자열은 값을 어디에도 출력하지 않는다. 변수 이름만 확인한다.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ITS_ENV="$HOME/.its-api.env"
DB_ENV="$REPO/.env"
LOG="$HOME/Library/Logs/traffic-room-collector.log"
NODE_BIN="$HOME/.nvm/versions/node/v24.15.0/bin"
STATE_DIR="${TRAFFIC_ROOM_STATE_DIR:-$HOME/Library/Application Support/traffic-room}"
LOCK_DIR="$STATE_DIR/collect.lock"
LOCK_STALE_MIN=30
EVENTS_MIN_GAP_SEC=600

WITH_CCTVS=0
FORCE_CCTVS=0
FORCE=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --cctvs) WITH_CCTVS=1; FORCE_CCTVS=1 ;;
    --force) FORCE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *) echo "알 수 없는 인자: $arg" >&2; exit 2 ;;
  esac
done

# 로그에는 상태 한 줄만 남기고, 혹시 섞인 접속 문자열은 가린다.
log() {
  local line
  line="$(printf '%s %s' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | sed -E -e 's#postgres(ql)?://[^[:space:]]+#postgres://***#g' -e 's#(apiKey=)[^&[:space:]]+#\1***#g')"
  if [ -n "${ITS_API_KEY:-}" ]; then line="${line//"$ITS_API_KEY"/***}"; fi
  if [ -n "${DATABASE_URL:-}" ]; then line="${line//"$DATABASE_URL"/***}"; fi
  if [ "$DRY_RUN" -eq 1 ]; then echo "[dry-run] log: $line"; return; fi
  mkdir -p "$(dirname "$LOG")"
  echo "$line" >> "$LOG"
}

# 파일에서 NAME=값 줄을 찾아 값만 돌려준다. source 하지 않는다(URL 의 & 때문). 앞뒤 따옴표만 벗긴다.
read_var() {
  local file="$1" name="$2" v
  v="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${name}=" "$file" | tail -n 1 || true)"
  v="${v#*=}"
  v="${v%$'\r'}"
  if [[ "$v" == \"*\" ]]; then v="${v#\"}"; v="${v%\"}"
  elif [[ "$v" == \'*\' ]]; then v="${v#\'}"; v="${v%\'}"; fi
  printf '%s' "$v"
}

fail() { log "FAIL $*"; echo "$*" >&2; exit 1; }

# launchd 의 PATH 는 최소라서 nvm 의 node 를 앞에 붙인다. 없으면 현재 PATH 를 그대로 쓴다.
if [ -d "$NODE_BIN" ]; then PATH="$NODE_BIN:$PATH"; fi
export PATH
PNPM="$(command -v pnpm || true)"
[ -n "$(command -v node || true)" ] || fail "node 를 찾지 못했다. $NODE_BIN 에 node 가 있는지 확인한다."
[ -n "$PNPM" ] || fail "pnpm 을 찾지 못했다. $NODE_BIN 에 node 와 pnpm 이 있는지 확인한다."

[ -f "$ITS_ENV" ] || fail "$ITS_ENV 가 없다. ITS_API_KEY 를 넣은 파일이 필요하다."
[ -f "$DB_ENV" ] || fail "$DB_ENV 가 없다. DATABASE_URL 을 넣은 파일이 필요하다."
ITS_API_KEY="$(read_var "$ITS_ENV" ITS_API_KEY)"
DATABASE_URL="$(read_var "$DB_ENV" DATABASE_URL)"
[ -n "$ITS_API_KEY" ] || fail "$ITS_ENV 에 ITS_API_KEY 값이 없다."
[ -n "$DATABASE_URL" ] || fail "$DB_ENV 에 DATABASE_URL 값이 없다."

HOUR=$((10#$(date +%H)))
if [ "$HOUR" -eq 0 ] || [ "$HOUR" -eq 8 ] || [ "$HOUR" -eq 16 ]; then WITH_CCTVS=1; fi
JOBS=(events)
if [ "$WITH_CCTVS" -eq 1 ]; then JOBS+=(cctvs); fi

# 같은 시각에 두 번 도는 것을 막는다. launchd 가 잠자기 뒤 따라잡는 실행과 정각 5분 실행이 겹칠 수 있다.
stamp_file() { printf '%s/last-ok-%s' "$STATE_DIR" "$1"; }
cctvs_window() { printf '%s-%s' "$(date +%Y-%m-%d)" "$((HOUR / 8))"; }

should_skip() {
  local job="$1" f
  f="$(stamp_file "$job")"
  [ "$FORCE" -eq 1 ] && return 1
  [ -f "$f" ] || return 1
  case "$job" in
    events)
      local last now
      last="$(cat "$f" 2>/dev/null || echo 0)"
      now="$(date +%s)"
      [[ "$last" =~ ^[0-9]+$ ]] || return 1
      [ $((now - last)) -lt "$EVENTS_MIN_GAP_SEC" ] ;;
    cctvs)
      [ "$FORCE_CCTVS" -eq 1 ] && return 1
      [ "$(cat "$f" 2>/dev/null || true)" = "$(cctvs_window)" ] ;;
  esac
}

write_stamp() {
  case "$1" in
    events) date +%s > "$(stamp_file events)" ;;
    cctvs) cctvs_window > "$(stamp_file cctvs)" ;;
  esac
}

# 오래된 잠금(비정상 종료로 남은 것)은 넘겨받는다.
acquire_lock() {
  mkdir -p "$STATE_DIR"
  if mkdir "$LOCK_DIR" 2>/dev/null; then return 0; fi
  if [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin "+$LOCK_STALE_MIN" 2>/dev/null)" ]; then
    rmdir "$LOCK_DIR" 2>/dev/null || rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR" 2>/dev/null && return 0
  fi
  return 1
}

RUN_JOBS=()
for job in "${JOBS[@]}"; do
  if should_skip "$job"; then log "SKIP recent $job"; else RUN_JOBS+=("$job"); fi
done

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] repo:  $REPO"
  echo "[dry-run] pnpm:  $PNPM"
  echo "[dry-run] node:  $(command -v node || echo '없음')"
  echo "[dry-run] PATH:  $PATH"
  echo "[dry-run] $ITS_ENV: ITS_API_KEY 있음 (값은 출력하지 않음)"
  echo "[dry-run] $DB_ENV: DATABASE_URL 있음 (값은 출력하지 않음)"
  echo "[dry-run] 상태 디렉터리: $STATE_DIR"
  if [ -d "$LOCK_DIR" ]; then echo "[dry-run] 잠금: 잡혀 있음 (실행 시 SKIP locked)"; else echo "[dry-run] 잠금: 비어 있음"; fi
  echo "[dry-run] 지금 ${HOUR}시, 후보 작업: ${JOBS[*]}, 실제로 돌 작업: ${RUN_JOBS[*]:-없음}"
  echo "[dry-run] 로그: $LOG"
  exit 0
fi

if [ "${#RUN_JOBS[@]}" -eq 0 ]; then exit 0; fi
if ! acquire_lock; then log "SKIP locked"; exit 0; fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

export ITS_API_KEY DATABASE_URL
export ITS_MODE=live
cd "$REPO"

STATUS=0
for job in "${RUN_JOBS[@]}"; do
  # 수집기가 찍는 한 줄 요약만 받는다. 실패하면 마지막 줄만 로그에 남긴다.
  if out="$("$PNPM" --filter @traffic-room/collector "$job" 2>&1)"; then
    write_stamp "$job"
    log "OK $job: $(printf '%s' "$out" | tail -n 1)"
  else
    STATUS=1
    log "FAIL $job: $(printf '%s' "$out" | tail -n 1)"
  fi
done
exit "$STATUS"
