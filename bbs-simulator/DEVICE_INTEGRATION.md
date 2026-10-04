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
| `telemetry` | `id`, `sampled_at`, `device_id` (`'sim01'`), `rpm_inhale`, `rpm_exhale`, `co2_ppm`, `temp_c`, `rh_pct`, `phase` (`inhale`/`exhale`/`idle`) | read |
| `device_status` | `device_id` (pk), `last_seen`, `firmware`, `wifi_rssi` | read |
| `commands` | `id`, `created_at`, `device_id`, `command`, `params` (jsonb), `status`, `acked_at` | read, insert |

## Telemetry

- Sampled every 100 ms and uploaded in batches (~10 rows/s sharing one `created_at`; up to 50
  after an outage). **Always plot against `sampled_at`, never `created_at`.**
- On connect the app fetches the last 60 s by `sampled_at` (plus the newest row, for the current
  phase), then subscribes to inserts. It keeps a 60 s rolling buffer and re-renders ~3×/s.
- Display: 1 s averages; CO2 handled in ppm and shown in % (`ppm / 10000`), with a warning above
  45 000 ppm (the MH-Z16 saturates at 50 000). Tidal volume and peak pressure are not reported
  yet; the app shows "Not measured yet" and keeps room for them in its data model.
- Times are shown in Asia/Singapore.

## Device state (read from the device, never inferred from commands)

- **Online** = `device_status.last_seen` within the last 15 s (heartbeat every 5 s).
- **Running** = the newest telemetry row's `phase` is not `idle` (and that row is under 15 s old;
  older than that, the state is shown as unknown). A `start` marked `done` does **not** mean it is
  still running: the device failsafe stops it ~10 s after a network loss.

## Commands

The app inserts only:

```json
{ "command": "start", "params": { "bpm": 15, "duty": 60 } }
{ "command": "stop",  "params": {} }
```

- `device_id` and `status` come from the database defaults.
- The database accepts only `start`/`stop`, `bpm` 5–40 and `duty` 0–100. Missing values are
  allowed by the database and the firmware keeps its last used values, so the app **always sends
  both, as integers**. The UI validates the same ranges and shows database errors verbatim.
- `duty` is blower power (0–100 %), not I:E. I:E is fixed at 1:1 in the current firmware; the UI
  shows it disabled.
- Status lifecycle, watched via Realtime: `pending` → `done` (acknowledged) | `error` (not
  recognised) | `expired` (a start that arrived > 5 s late; the device was offline). Still pending
  after ~10 s → "No response from device" (the row is re-read once in case an update was missed).
  `expired` can arrive later than that, once the device is back online.
- Start is disabled while a start is pending or the device is offline. **Stop is never disabled.**

## Runs

A run is the stretch between the device starting and stopping:

1. Start inserts a `start` command; recording begins at the first non-idle row.
2. It ends when a row reports `idle` (the end time is that row's `sampled_at`), or when the user
   presses Stop (a `stop` command is sent and the recording ends at that moment).

Live runs keep only their time range and settings (on the phone for now; a Supabase runs table
is proposed, not created) and fetch their readings from `telemetry` when opened. Demo runs are
stored on the phone, under separate keys, and never listed with real runs.

## Demo mode

`src/device/demoBackend.ts` imitates the device for testing without hardware: rows every 100 ms
delivered in batches of 10 per second, a heartbeat every 5 s, commands acknowledged after ~0.5 s,
I:E 1:1, and only the active phase's fan spinning (~70 RPM per % of blower power, as measured on the
rig). Temperature, humidity and CO2 are random within the test firmware's ranges. Every screen
shows a "DEMO · simulated data" banner.

## Files

| File | What it does |
| --- | --- |
| `src/device/types.ts` | The contract: row/command types, `DEVICE_ID`, the bpm/duty validation. |
| `src/device/supabaseBackend.ts` | Realtime subscription, history fetch, command insert, range fetch for runs. |
| `src/device/demoBackend.ts` | The simulated device. |
| `src/state/DeviceContext.tsx` | Rolling buffer, online/running state, command tracking. |
| `src/state/RunContext.tsx` | Run start/stop and saving. |
