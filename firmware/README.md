# ESP4902 firmware

## `esp4902_final/` (final-1.0-twin): the one to flash

Two WS7040 fans at 15 V (inhale fan sucks through one nostril, exhale fan blows out of the
other; only one runs at a time), the installed-calibration digital twin from
`twin_installed_breathing.ino`, and v4's Supabase / WiFi / FreeRTOS structure and safety rules.
The header comment in `esp4902_final.ino` lists the tasks, control loop, commands and columns.

- Libraries: ArduinoJson v7, Adafruit BME280 (+ Adafruit Unified Sensor).
- Copy `secrets.example.h` to `secrets.h` (git-ignored) and fill in WiFi and the Supabase
  **publishable** key.
- **Before flashing:** apply `../supabase/migrations/20261111_final_pressure.sql` (adds
  `telemetry.pressure_hpa`). Until it is applied, every telemetry batch is rejected. To run
  without it, set `SEND_PRESSURE = false`.
- Presets (start by name): `demo_15` (default, peak 15 L/min, within both fans), `walk_slow`,
  `walk_fast`, `light_f`, `light_m`. All but `demo_15` are above the exhale fan's ~17 L/min, so
  their exhale peaks clip (fault 3).

```json
{ "command": "start", "params": { "mode": "flow", "preset": "walk_slow" } }
{ "command": "start", "params": { "mode": "flow", "vt": 0.3, "bpm": 15, "ie_ratio": 1 } }
{ "command": "stop",  "params": {} }
```

Presets go by name because `commands_params_check` casts `bpm` to an integer (20.5 is refused).
The final firmware only runs flow breaths: a start without a preset or Vt/bpm runs `demo_15`,
so the app blocks free-flow and duty-breath starts when the device reports `final-…`.

## `esp4902_twin/` (blower-0.8-twin, superseded)

`esp4902_twin/` is **blower-0.8-twin**: firmware 0.7 (Supabase control of the WS7040 blower)
plus the digital twin and a flow-based breath mode. The header comment in
`esp4902_twin.ino` explains the twin, the commands and how the trim gain was chosen.

## Build

- Board: ESP32S3 Dev Module, DIO 80 MHz, PSRAM disabled, 16 MB flash.
- ESP32 Arduino core 3.x (checked on 3.3.12); 2.x also handled.
- Library: ArduinoJson v7 (checked on 7.4.2).
- Copy `secrets.example.h` to `secrets.h` and fill in WiFi and the Supabase **publishable** key.
  `secrets.h` is git-ignored.

## Database

`../supabase/migrations/20261103_twin_telemetry.sql` is applied to ESP4902 (2026-11-04). For any other database, apply it before flashing: PostgREST rejects a
telemetry batch that names a column the table doesn't have. The app reads the twin columns while `TWIN_COLUMNS_ENABLED =
true` in `bbs-simulator/src/device/supabaseBackend.ts`.

## Start a flow breath

Insert into `public.commands`:

```json
{ "command": "start", "params": { "mode": "flow", "vt": 1.92, "bpm": 26, "ie_ratio": 1 } }
```

## TBD constants (all in `esp4902_twin.ino`)

| Constant | Now | What it needs |
|---|---|---|
| `PWM_PIN_EX`, `TACH_PIN_EX` | -1 | Exhale blower pins. While -1 the inhale blower drives both halves. |
| `SERVO_PIN` | -1 | Flap servo signal pin. While -1 no servo is driven. |
| `SERVO_ANGLE_INHALE`, `SERVO_ANGLE_EXHALE` | 0°, 90° | Flap angles for each path. |
| `SERVO_MOVE_MS` | 150 ms | Time the flap needs to move (fans held off meanwhile). |
| `TRIM_KI` | 0.0005 | Trim gain, % duty per rpm·s. Tune on the rig. |
| `TRIM_LAG_TICKS` | 7 (0.7 s) | rpm lag behind duty used by the trim (0.6–0.9 s measured). |
| `FAULT_HOLD_MS` | 2000 ms | How long a fault must persist. |
| `PRESSURE_PIN`, `readPressurePa()` | -1 / none | Pressure sensor pin and calibration (future; `USE_PRESSURE = false`). |
| `FAULT_TOL_PCT`, `FAULT_MIN_DP_PA` | 15 %, 5 Pa | Pressure-residual thresholds (future). |
| Exhale operating points | = calibrated fan | Exhale fan not calibrated yet. |
| ICRP 66 presets | in the app | Confirm Vt/bpm values (`bbs-simulator/src/constants/twin.ts`). |
