-- Run this once in Supabase SQL Editor
-- Creates a single-row KV store for match state

create table if not exists overlay_state (
  id text primary key default 'singleton',
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- Insert default row
insert into overlay_state (id, state)
values ('singleton', '{
  "homeName": "HOME",
  "homeAbbr": "HME",
  "homeColor": "#EE2020",
  "homeScore": 0,
  "awayName": "AWAY",
  "awayAbbr": "AWY",
  "awayColor": "#003DA5",
  "awayScore": 0,
  "timer": 0,
  "timerRunning": false,
  "status": "PRE",
  "injuryTime": 0,
  "visible": true
}'::jsonb)
on conflict (id) do nothing;

-- Allow anon read/write (for demo; add auth for production)
alter table overlay_state enable row level security;

create policy "allow_all" on overlay_state
  for all using (true) with check (true);
