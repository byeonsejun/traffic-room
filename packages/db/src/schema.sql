create table if not exists incidents (
  key text primary key,
  category text not null,
  road_name text not null,
  direction text not null,
  detail text not null,
  message text not null,
  lanes_blocked text not null,
  lon double precision not null,
  lat double precision not null,
  started_at timestamptz,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  arrive_at timestamptz,
  cleared_at timestamptz
);

create table if not exists event_log (
  id bigserial primary key,
  kind text not null check (kind in ('arrived', 'cleared')),
  incident_key text not null references incidents (key),
  emit_at timestamptz not null
);
create index if not exists event_log_emit_at_idx on event_log (emit_at);

create table if not exists collector_runs (
  id bigserial primary key,
  service text not null check (service in ('events', 'cctv')),
  ran_at timestamptz not null,
  ok boolean not null,
  count integer not null
);
create index if not exists collector_runs_service_ran_at_idx on collector_runs (service, ran_at);

create table if not exists cctvs (
  id text primary key,
  name text not null,
  lon double precision not null,
  lat double precision not null,
  url text not null,
  fetched_at timestamptz not null
);

-- 1차 배포본은 ('events', 'cctv') 만 허용했으므로 제약을 교체한다. 다시 돌려도 안전하다.
alter table collector_runs drop constraint if exists collector_runs_service_check;
alter table collector_runs add constraint collector_runs_service_check check (service in ('events', 'cctv', 'traffic'));

create table if not exists traffic_snapshots (
  id bigserial primary key,
  data_at timestamptz not null unique,
  collected_at timestamptz not null,
  show_at timestamptz not null,
  link_count integer not null,
  avg_speed real not null,
  ok integer not null,
  slow integer not null,
  jam integer not null,
  jam_km real not null
);
create index if not exists traffic_snapshots_show_at_idx on traffic_snapshots (show_at);

create table if not exists link_speeds (
  snapshot_id bigint not null references traffic_snapshots (id) on delete cascade,
  link_id text not null,
  speed smallint not null,
  primary key (snapshot_id, link_id)
);

create table if not exists traffic_buckets (
  data_at timestamptz primary key,
  avg_speed real not null,
  ok integer not null,
  slow integer not null,
  jam integer not null,
  jam_km real not null
);

create table if not exists route_buckets (
  data_at timestamptz not null,
  route text not null,
  avg_speed real not null,
  primary key (data_at, route)
);
