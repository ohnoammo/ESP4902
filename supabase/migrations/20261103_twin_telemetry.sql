-- Digital twin columns for firmware blower-0.8-twin. Applied to ESP4902 on 2026-11-04 as 'twin_telemetry'.
-- Additive only: existing rows and firmware 0.7 are unaffected (new columns are nullable, and
-- 0.7 simply doesn't send them). Twin columns are null outside flow mode.

alter table public.telemetry
  add column if not exists q_target     real,      -- L/min, target flow magnitude (sign from phase)
  add column if not exists q_twin       real,      -- L/min, twin flow at the measured rpm
  add column if not exists dp_twin      real,      -- Pa, CFD system curve at q_twin
  add column if not exists dp_meas      real,      -- Pa, measured (null: no pressure sensor yet)
  add column if not exists residual_pct real,      -- (dp_meas - dp_twin) / dp_twin * 100 (null: no sensor)
  add column if not exists rpm_expected real,      -- rpm the operating points expect for the duty
  add column if not exists trim         real,      -- learned duty correction, % duty
  add column if not exists twin_valid   boolean,   -- false below 40 % duty (calibration not validated)
  add column if not exists fault        smallint;  -- 0 ok, 1 no spin, 2 trim at limit, 3 leak, 4 blockage (3/4 need a pressure sensor)

alter table public.telemetry
  drop constraint if exists telemetry_fault_check,
  add constraint telemetry_fault_check check (fault is null or fault between 0 and 4);

comment on column public.telemetry.q_twin is 'L/min, twin flow at the measured rpm (operating-point table). Null outside flow mode.';
comment on column public.telemetry.fault is '0 ok, 1 no spin, 2 trim at limit, 3 leak, 4 blockage (3/4 need a pressure sensor). Null outside flow mode.';

-- public.runs is unchanged: the twin page starts flow breaths without recording a run yet.
-- Saving flow runs later will need runs.mode to allow 'flow' and a column for Vt.
