-- Firmware final-1.0-twin (firmware/esp4902_final). NOT APPLIED YET: needs the team's OK.
--
-- Apply this BEFORE flashing final-1.0-twin with SEND_PRESSURE = true: PostgREST rejects a
-- whole telemetry batch that names a column the table doesn't have, so until this runs no
-- telemetry from that firmware is saved. The app reads every column (select *), so it works
-- before and after.
--
-- 1. telemetry.pressure_hpa: ambient pressure from the BME280 (hPa). Nullable, additive.
-- 2. Comments only: fault 3 now means "target above fan capacity" (the final firmware has
--    no pressure sensor, so the old 3 = leak / 4 = blockage codes are never sent). The
--    existing check (fault null or 0..4) already allows every code, so it is unchanged.

alter table public.telemetry
  add column if not exists pressure_hpa real;

comment on column public.telemetry.pressure_hpa is
  'hPa, ambient pressure from the BME280 (firmware final-1.0-twin). Null when no BME280 is found.';
comment on column public.telemetry.temp_c is
  '°C from the BME280 (firmware final-1.0-twin). Null when no BME280 is found.';
comment on column public.telemetry.rh_pct is
  '% RH from the BME280 (firmware final-1.0-twin). Null when no BME280 is found.';
comment on column public.telemetry.q_target is
  'L/min, target flow MAGNITUDE; sign from phase (inhale +, exhale -). Null outside flow mode.';
comment on column public.telemetry.q_twin is
  'L/min, estimated airflow: installed calibration flow at the measured rpm of the fan doing the phase (magnitude; sign from phase). Null outside flow mode.';
comment on column public.telemetry.fault is
  'final-1.0-twin: 0 ok, 1 no spin (>2 s while commanded), 2 trim saturated, 3 target above fan capacity (fan held at 100 %). Null outside flow mode.';

-- Undo:
--   alter table public.telemetry drop column pressure_hpa;
