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
