# Final firmware + app update (Nov 2026)

## Firmware: `firmware/esp4902_final/` (final-1.0-twin)
- v4's Supabase/WiFi/FreeRTOS sketch with the two-fan installed-calibration control loop from
  `twin_installed_breathing.ino` (built in an earlier session).
- Fixed in this commit: comments said the default preset was `demo_low`; it is `demo_15`.
  Added `SEND_NEW_COLUMNS` so the firmware can run without the new columns.

## App (`bbs-simulator/`)
- **Twin model** (`src/constants/twin.ts`): the installed calibration replaces the old
  operating points. Capacity: exhale 17.3 L/min, inhale 105.1 L/min.
- **Presets**: Demo (15 L/min), Walking slow / fast, Light exercise female / male: the
  firmware's ids, started by name (`{"mode":"flow","preset":"walk_slow"}`).
- **Custom breath editor**: peak = π·Vt·f; warns (never blocks) above 17 L/min (exhale) or
  105 L/min (inhale). Vt range 0.1–2.5 L, as the firmware.
- **Digital twin page**: signed target and estimated airflow on the same axes over the last
  15 s (+ inhale, − exhale), labelled "Estimated airflow (installed calibration)".
- **Fault banner** (app-wide, under the demo strip, never over Stop): fault 3 "Exhale target
  above simulator capacity: peaks are being clipped." (or inhale, if > 105 L/min); faults 1
  and 2 with short messages. Held 5 s so it doesn't flash every breath; dismissable per run.
- **Sensors**: BME280 temperature, humidity and ambient pressure (live screen and run chips).
- **CSV export**: inhale and exhale fan rpm, target flow and estimated airflow (1 s means,
  signed), highest fault per second, ambient pressure.
- **Demo mode**: simulates the final firmware (two fans, 0.2 s lead, KP feedback, trim,
  faults, 10-breath runs, BME280). Clipped presets show fault 3 at their exhale peaks.
- **Free flow** on either fan: the editor has an Inhale fan / Exhale fan choice; the firmware
  runs that fan at a fixed duty until Stop (`{"mode":"free","duty":50,"fan":"exhale"}`).
  Telemetry `active_fan` says which fan runs, so exhale free flow plots below 0.
- Starting an old duty-breath simulator is blocked on `final-…` firmware.

## Supabase
- `supabase/migrations/20261111_final_pressure.sql`: adds `telemetry.pressure_hpa` and
  `telemetry.active_fan`, and updates column comments. **Applied to ESP4902 on 2026-11-10.**
- `20261106_flow_runs.sql`: applied to ESP4902 on 2026-11-10 and `FLOW_RUNS_IN_DB = true`, so
  flow runs are saved as `runs` rows.
