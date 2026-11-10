-- Firmware final-1.0-twin (firmware/esp4902_final). NOT APPLIED YET: needs the team's OK.
--
-- Apply this BEFORE flashing final-1.0-twin with SEND_NEW_COLUMNS = true: PostgREST rejects a
-- whole telemetry batch that names a column the table doesn't have, so until this runs no
-- telemetry from that firmware is saved. The app reads every column (select *), so it works
-- before and after.
--
-- 1. telemetry.pressure_hpa: ambient pressure from the BME280 (hPa). Nullable, additive.
-- 1b. telemetry.active_fan: the fan being driven ('inhale' / 'exhale', null when idle). Needed
--     for free flow, where the phase ('free', ...) doesn't say which fan runs. Nullable, additive.
-- 2. Comments only: fault 3 now means "target above fan capacity" (the final firmware has
--    no pressure sensor, so the old 3 = leak / 4 = blockage codes are never sent). The
--    existing check (fault null or 0..4) already allows every code, so it is unchanged.

alter table public.telemetry
  add column if not exists pressure_hpa real,
  add column if not exists active_fan   text;

alter table public.telemetry
  drop constraint if exists telemetry_active_fan_check,
  add constraint telemetry_active_fan_check check (active_fan is null or active_fan in ('inhale', 'exhale'));

comment on column public.telemetry.active_fan is
  'Fan being driven: inhale or exhale (firmware final-1.0-twin). Null when idle. In free flow it gives the sign of q_target / q_twin.';

comment on column public.telemetry.pressure_hpa is
  'hPa, ambient pressure from the BME280 (firmware final-1.0-twin). Null when no BME280 is found.';
comment on column public.telemetry.temp_c is
  '°C from the BME280 (firmware final-1.0-twin). Null when no BME280 is found.';
comment on column public.telemetry.rh_pct is
  '% RH from the BME280 (firmware final-1.0-twin). Null when no BME280 is found.';
comment on column public.telemetry.q_target is
  'L/min, target flow MAGNITUDE (free flow: what the table expects at the duty); sign from phase (inhale +, exhale -), or active_fan in free flow. Null when idle.';
comment on column public.telemetry.q_twin is
  'L/min, estimated airflow: installed calibration flow at the measured rpm of the fan doing the phase (magnitude; sign from phase, or active_fan in free flow). Null when idle.';
comment on column public.telemetry.fault is
  'final-1.0-twin: 0 ok, 1 no spin (>2 s while commanded), 2 trim saturated, 3 target above fan capacity (fan held at 100 %). Null when idle.';

-- Undo:
--   alter table public.telemetry drop constraint telemetry_active_fan_check;
--   alter table public.telemetry drop column active_fan;
--   alter table public.telemetry drop column pressure_hpa;
