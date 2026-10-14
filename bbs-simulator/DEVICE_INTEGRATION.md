# Device integration (ESP4902 Supabase project)

The app never talks to the ESP32 directly. The device and the app meet in the ESP4902 Supabase
project (Singapore region): the device writes telemetry and heartbeats and acknowledges
commands; the app reads those over Realtime and inserts commands.

## Connection

- `.env` (copy `.env.example`): `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
  Use the **publishable** key only, never the secret key. `.env` is git-ignored.
- Client: `@supabase/supabase-js`, anon role, no sign-in (`src/lib/supabase.ts`).
- Updates arrive via Realtime (`postgres_changes`), not polling. The app subscribes first, then
  loads history, so no row is missed between the two (duplicates are dropped by id).
- The app does not change the schema, policies or constraints.

## Tables (RLS on, anon allowed)

| Table | Columns the app uses | App access |
| --- | --- | --- |
| `telemetry` | `id`, `sampled_at`, `device_id` (`'sim01'`), `phase`, `duty_cmd`, `rpm_inhale`, `rpm_exhale`, `co2_ppm`, `temp_c`, `rh_pct` | read |
| `device_status` | `device_id` (pk), `last_seen`, `firmware`, `wifi_rssi` | read |
| `commands` | `id`, `created_at`, `device_id`, `command`, `params` (jsonb), `status`, `acked_at` | read, insert |
| `runs` | `id`, `device_id`, `name`, `mode`, `started_at`, `ended_at`, `ended_by`, `bpm`, `duty`, `ie_ratio`, `firmware`, `headform`, `mask`, `notes`, `archived`, `start_command_id`, `stop_command_id` | read, insert, update (no delete) |

## Telemetry

- Sampled every 100 ms and uploaded in batches (~10 rows/s sharing one `created_at`; up to 50
  after an outage). **Always plot against `sampled_at`, never `created_at`.**
- On connect the app fetches the last 60 s by `sampled_at` (plus the newest row, for the current
  phase), then subscribes to inserts. It keeps a 60 s rolling buffer and re-renders ~3×/s.
- `phase` (firmware blower-0.7): `idle`, `inhale`, `exhale` (breath), `free`, `free_kick`,
  `free_below`, `free_sat`, `free_nospin` (free flow). Every value except `idle` is a run in
  progress; `free_below` and `free_nospin` are runs with zero flow. Only a value the app doesn't
  know is treated as `idle`.
- `duty_cmd` is the duty written to the PWM; `rpm_inhale` is the (single) blower's speed. The live
  chart plots both against `sampled_at` so the blower's ~0.6 s lag is visible.
- Columns the firmware doesn't send stay **null**, never 0: in 0.7 that is `co2_ppm`, `temp_c`,
  `rh_pct` (sensors not wired, shown as "Not connected") and `rpm_exhale` (second blower).
- Display: 1 s averages; CO2 handled in ppm and shown in % (`ppm / 10000`), with a warning above
  45 000 ppm (the MH-Z16 saturates at 50 000). Tidal volume and peak pressure are not reported
  yet; the app shows "Not measured yet" and keeps room for them in its data model.
- One old batch of 50 rows has no `sampled_at`. The app ignores such rows, including in its
  "newest row" query (Postgres sorts nulls first in a descending order).
- Times are shown in Asia/Singapore.

## Device state (read from the device, never inferred from commands)

- **Online** = `device_status.last_seen` within the last 15 s (heartbeat every 5 s).
- **Running** = the newest telemetry row's `phase` is not `idle` (and that row is under 15 s old;
  older than that, the state is shown as unknown). A `start` marked `done` does **not** mean it is
  still running: the device failsafe stops it ~10 s after a network loss.

## Commands

The app inserts only:

```json
{ "command": "start", "params": { "mode": "breath", "bpm": 15, "duty": 50, "ie_ratio": 1 } }
{ "command": "start", "params": { "mode": "free", "duty": 50 } }
{ "command": "stop",  "params": {} }
```

- `device_id` and `status` come from the database defaults.
- The database accepts only `start`/`stop`, `bpm` 5–40 and `duty` 0–100. Missing params keep the
  firmware's **last used** values, so a breath start **always sends `mode`, `bpm`, `duty` and
  `ie_ratio`** (a stale I:E can't be applied silently); a free start sends `mode` and `duty`. The
  UI validates the same ranges and shows database errors verbatim.
- Breath: `duty` is the PEAK of the inhale half-sine (the firmware clamps it to 20–100; exhale holds
  20 %), `ie_ratio` is E/I, 1 to 4 in the app (the firmware accepts 0.25–4). Free: `duty` is fixed,
  0–100; bpm and I:E are ignored. A breath preset needs a breathing rate before it can start.
- Duty bands (15 V, open air) all live in `src/constants/dutyBands.ts`; they classify the preset's
  peak (breath) or fixed (free) duty and never block Start. Firmware phases `free_kick`,
  `free_below`, `free_nospin` and `free_sat` are shown as banners over the band.
- Status lifecycle, watched via Realtime: `pending` → `done` (acknowledged) | `error` ("Device
  rejected the command.": unknown command, or free mode with no duty) | `expired` (a start that arrived > 5 s late; the device was offline). Still pending
  after ~10 s → "No response from device" (the row is re-read once in case an update was missed).
  `expired` can arrive later than that, once the device is back online.
- Start is disabled while a start is pending or the device is offline. **Stop is never disabled.**

## Runs

A run is the stretch between the device starting and stopping:

1. Start inserts a `start` command; recording begins at the first non-idle row.
2. It ends when a row reports `idle` (the end time is that row's `sampled_at`), or when the user
   presses Stop (a `stop` command is sent and the recording ends at that moment).

Live runs are rows in `runs` (`src/device/runsApi.ts`):

- **Insert** when recording begins: `name`, `mode`, `started_at` (sampled_at of the first non-idle
  row), `bpm` and `ie_ratio` (null for free runs; the database requires `bpm` for breath), `duty`, `firmware` (copied from `device_status`), `start_command_id`, and
  the test details `headform`, `mask`, `notes` entered on the Ready screen. `ended_at` stays null.
- **Update** when it ends: `ended_at`, `ended_by` (`user` or `device`), `stop_command_id`.
- **Edit** afterwards: `name` (rename) and `headform`/`mask`/`notes` (Test details card).
- **Delete** in the app sets `archived = true` (there is no delete policy); archived runs are hidden.
- **Readings** are fetched from `telemetry` by `started_at`..`ended_at` when a run is opened.
- **Left open** (app closed mid-run): on connect, if the device is still running the app resumes
  recording that run; otherwise it closes it at the first idle row, `ended_by = 'device'`. The
  database allows only one open run per device.
- New and changed rows arrive via Realtime, so runs from another phone appear too.
- Folders and list order are kept on each phone, not in Supabase.

Demo runs are stored on the phone, under separate keys, and never listed with real runs.

## Demo mode

`src/device/demoBackend.ts` imitates firmware blower-0.7 for testing without hardware: rows every
100 ms delivered in batches once a second, a heartbeat every 5 s, commands acknowledged after
~0.5 s. Breath duty follows the half-sine from the 20 % floor with I:E; free flow emits
`free_below` under 19 %, a 1 s `free_kick` at 25 % from standstill at low duty, and `free_sat` at
100 %. The blower's rpm follows the duty ~0.6 s late towards the measured 15 V open-air steady state
(19 % 2,460 · 30 % 4,965 · 50 % ~9,100 · 70 % 13,545 · 100 % 20,100 rpm, interpolated) and coasts
down at most ~2,500 rpm/s. CO2, temperature, humidity and the second blower are null, as in 0.7.
Every screen shows a "DEMO · simulated data" banner.

## Files

| File | What it does |
| --- | --- |
| `src/device/types.ts` | The contract: row/command types, phases, `DEVICE_ID`, start-param validation. |
| `src/constants/dutyBands.ts` | Every duty band edge, phase banners and the measured breath limitation. |
| `src/constants/presets.ts` | Default presets; the Walking / light rate the team must source. |
| `src/device/supabaseBackend.ts` | Realtime subscription, history fetch, command insert, range fetch for runs. |
| `src/device/demoBackend.ts` | The simulated device. |
| `src/state/DeviceContext.tsx` | Rolling buffer, online/running state, command tracking. |
| `src/device/runsApi.ts` | The `runs` table: list, insert, update, Realtime. |
| `src/state/RunContext.tsx` | Run start/stop, writing the run row, recovering a run left open. |
