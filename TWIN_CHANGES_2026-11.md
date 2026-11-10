# Digital twin + flow-breath simulators (Nov 2026)

What changed in this package since the last version (branch `twin-ui`, not committed yet).

## App (`bbs-simulator/`)

**Digital twin page** (`src/screens/TwinScreen.tsx`)
- Rig diagram: inhale fan, exhale fan, flap and headform; the active path is coloured and
  animated in the direction of flow (in on inhale, out on exhale); only the active fan spins.
- Live plots: **Flow** (target vs twin flow from measured rpm) and **Blower speed** (measured vs
  expected rpm, with the learned trim).
- Status: phase, fan fault (OK / No spin / Trim at limit), share of the breath inside the
  validated calibration (duty ≥ 40 %).
- Flow-breath controls: the 4 presets or any Vt + rate, Start / Stop.
- "Where these numbers come from": what is measured (only rpm) and what is calculated.
- Pressure (plot and values) removed from the page: no pressure sensor, and not useful to
  someone testing a mask. The firmware still computes and stores it.

**Simulators are now flow breaths** (Vt + breathing rate), run by the digital twin
- Activity presets = 4 ICRP 66 flow breaths (`src/constants/twin.ts`, `TWIN_PRESETS`):

  | Activity | Vt (L) | bpm | VE (L/min) | Peak (L/min) |
  |---|---|---|---|---|
  | Light exercise, female | 0.992 | 21 | 20.8 | 65 |
  | Light exercise, male | 1.25 | 20 | 25.0 | 79 |
  | Heavy exercise, female | 1.364 | 33 | 45.0 | 141 |
  | Heavy exercise, male | 1.92 | 26 | 49.9 | 157 |

- Custom simulators: Flow breath (Vt 0.3–2.5 L, 5–40 bpm, 1:1) or Free flow (fixed duty).
  The editor shows VE, peak flow and the device limits live (peak = π × Vt × bpm):
  validated 65.6–173.4 L/min, runs but not validated 30.3–65.6, fan off below 30.3 (can't be
  saved), clipped above 173.4. Also the validated Vt range for the chosen rate.
- Starting any flow simulator runs the twin, so the twin page shows that run.
- Saved duty-based simulators (old "Breathing" mode) are converted to flow breaths when loaded:
  same rate, same peak flow (operating-point flow at their peak duty, Vt = peak / (π × bpm)).
  Recorded runs keep their original duty settings.
- No breath-rate warnings for now (the flap may help the fan slow down; see the speed test).

**Data**
- Telemetry: reads the twin columns (`TWIN_COLUMNS_ENABLED = true` in `src/device/supabaseBackend.ts`).
- Demo mode simulates the twin (flow from rpm, lagged rpm trim per duty band, faults).

## Firmware (`firmware/esp4902_twin/`, blower-0.8-twin)
- 0.7 plus the digital twin and a flow-breath mode: `start {"mode":"flow","vt":1.25,"bpm":20,"ie_ratio":1}`.
- Twin: target flow → duty (operating points); measured rpm → twin flow; rpm trim per duty band
  and per fan, kept between breaths (battery sag); faults: no spin, trim at limit.
- Two fans + flap servo supported (pins at the top of the sketch).
- Credentials in `secrets.h` (git-ignored; copy `secrets.example.h`). **Not included in this zip.**

## Supabase (`supabase/migrations/`)
- `20261103_twin_telemetry.sql`: twin columns on `telemetry`. **Applied** to ESP4902 (2026-11-04).
- `20261106_flow_runs.sql`: lets `runs` store flow runs (`mode = 'flow'`, `vt_l`). **Not applied
  yet.** Until it is, flow runs start and show on the twin page but are **not saved as runs**
  (the app says so). After applying, set `FLOW_RUNS_IN_DB = true` in `src/device/runsApi.ts`.

## Tests (`firmware/`)
- `fan_check/`: wiring check. `breath_test_free/`: slow-breath test with the testo.
  `speed_test_free/`: breath-speed sweep with/without a 600 ms lead (results in the speed-test
  write-up; data not included here).

## Running the app
```
cd bbs-simulator
npm install
cp .env.example .env      # fill in the Supabase URL and publishable key
npx expo start            # press w for web
```
