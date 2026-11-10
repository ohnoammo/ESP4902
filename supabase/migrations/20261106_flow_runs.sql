-- Flow-breath runs (simulators set by tidal volume + rate, run by the digital twin).
-- Applied to ESP4902 on 2026-11-10 as 'flow_runs' (FLOW_RUNS_IN_DB = true in
-- bbs-simulator/src/device/runsApi.ts).
--
-- 1. runs.mode also allows 'flow'. This replaces the existing check; every existing row
--    ('breath' / 'free') still passes it.
-- 2. runs.vt_l: tidal volume (L) of a flow run. Nullable, additive.
-- 3. A flow run needs bpm and vt_l (like breath runs need bpm).
-- runs.duty stays required: a flow run stores the twin's peak feed-forward duty.

alter table public.runs drop constraint if exists runs_mode_check;
alter table public.runs add constraint runs_mode_check check (mode = any (array['breath', 'free', 'flow']));

alter table public.runs add column if not exists vt_l real;

alter table public.runs drop constraint if exists runs_flow_needs_bpm_vt;
alter table public.runs add constraint runs_flow_needs_bpm_vt
  check (mode <> 'flow' or (bpm is not null and vt_l is not null));

-- Undo:
--   alter table public.runs drop constraint runs_flow_needs_bpm_vt;
--   alter table public.runs drop column vt_l;
--   alter table public.runs drop constraint runs_mode_check;
--   alter table public.runs add constraint runs_mode_check check (mode = any (array['breath', 'free']));
--   (the last step fails while any 'flow' rows exist)
