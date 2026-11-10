# App changes for firmware blower-0.7 (supersedes MODES_AND_SUPABASE_SPEC.md)

Written 2026-10-14 against THIS copy of the app (OneDrive `bbs-simulator`) and the live
Supabase project. The older `MODES_AND_SUPABASE_SPEC.md` in `C:\Users\kwekt\ESP4902` was
written against a stale repo copy (WebSocket era). Ignore it.

Everything already working here stays as it is (Supabase backend, sampled_at plotting, CO2 in
%, runs lifecycle, demo mode). Below is only what the new firmware changes.

## Ground truth (firmware blower-0.7, tested on hardware 2026-10-14)

Start params the firmware accepts.

| Param | Breath mode (default) | Free mode |
|---|---|---|
| `mode` | omitted or `"breath"` | `"free"` |
| `duty` | PEAK duty of the inhale half-sine, clamped 20..100. Exhale holds 20 % | Fixed duty 0..100, sent as-is. Missing = command `error` |
| `bpm` | 5..40 | ignored |
| `ie_ratio` | E/I, clamped 0.25..4. **Now supported**, no longer fixed 1:1 | ignored |

**Missing params keep the firmware's last-used value.** So the app must always send `bpm`,
`duty` and `ie_ratio` for breath mode, or a stale I:E from an earlier command will be used.

`telemetry.phase` values now seen in the live table:
`idle`, `inhale`, `exhale`, `free`, `free_kick`, `free_below`, `free_sat`, `free_nospin`.

New column `telemetry.duty_cmd` (real). Duty actually written to the PWM at that sample.

`runs` now has `mode` (`'breath'` default, or `'free'`). `bpm` and `ie_ratio` are nullable, and
the DB enforces `bpm not null` when `mode = 'breath'`.

## 1. CRITICAL. Phase mapping breaks free mode

`supabaseBackend.ts` `toPhase()` maps anything that is not `inhale`/`exhale` to `idle`. Every
free-mode row therefore looks idle. Effects. `running` is false during a free-flow run, a
recording never begins (or ends immediately as `ended_by = 'device'`), and Start is not
disabled while the blower is spinning.

Fix. Widen `Phase`:

```ts
export type Phase = 'inhale' | 'exhale' | 'idle'
  | 'free' | 'free_kick' | 'free_below' | 'free_sat' | 'free_nospin';
```

Map unknown strings to `idle` only if they really are unknown. "Running" stays
`phase !== 'idle'`, which is correct for all free phases (the firmware is in a run; `free_below`
and `free_nospin` are runs with zero flow, not stopped runs).

## 2. Send I:E, enable the slider

`RunContext.tsx` sends `{ bpm, duty }` only. Send `{ bpm, duty, ie_ratio }` always for breath.
Remove "Fixed 1:1 in current firmware" from NewSimulator and Ready, enable the I:E slider
(1 to 4, step 0.5 is fine, the firmware accepts 0.25..4). Add `ie_ratio` to `StartParams` and
`validateStart` (0.25..4).

## 3. Free flow mode

- `Simulator` gets `mode: 'breath' | 'free'`. Load-time default for saved presets is `'breath'`.
- NewSimulator. A Breathing / Free flow `SegmentedToggle`. Free flow shows the duty slider only.
- Start sends `{ mode: 'free', duty }`. `validateStart` skips bpm and I:E for free mode.
- `insertRun` writes `mode`, and `bpm`/`ie_ratio` as null for free mode (the DB rejects a breath
  run without bpm, and accepts null bpm only for free).
- Ready, Running, run cards and CSV show "Free flow, X %" instead of bpm and I:E.

## 4. Duty bands and warnings (all 15 V, open air)

Put every edge in one file (`src/constants/dutyBands.ts`). They will move after the loaded sweep.

| Duty | Band | Level |
|---|---|---|
| < 19 | No flow. Driver will not run | error |
| 19 to 36 | Below human range | warn |
| 36 to 64 | Walking / light | ok |
| 64 to 72 | Between modes | info |
| 72 to 88 | Heavy | ok |
| 88 to 99 | Above heavy (open air only) | warn |
| 100 | Saturated | warn |

The old 17 to 19 "deadband" band is gone. Hardware test 2026-10-14 showed 18 % does not hold.
Breath mode is classified on its peak `duty`. Free mode on its fixed duty. Warnings never block
Start.

Live state banners from the firmware `phase` (ground truth, shown over the band):
`free_kick` "Kick-starting fan" (info), `free_below` "Below 19 %. No flow" (error),
`free_nospin` "Output on but fan not turning. Check wiring" (error),
`free_sat` "Saturated. No headroom under load" (warn).

## 5. Breath mode honesty (measured, 2026-10-14)

The blower lags duty by about 0.6 s and cannot brake (it coasts down at ~2,000 to 3,000 rpm/s).
Measured inhale/exhale contrast (mean rpm in inhale ÷ mean rpm in exhale):

| bpm | Peak duty | Swing achieved vs commanded | Inhale ÷ exhale rpm |
|---|---|---|---|
| 15 | 50 % | ~80 % | 1.08 |
| 20 | 65 % | ~58 % | 0.88 |
| 30 | 80 % | ~33 % | 0.78 |

So above ~15 bpm the "inhale" blower is faster during exhale than during inhale. A firmware phase
lead is being tested to fix the timing. For the app this means:
- The live chart must plot `duty_cmd` and `rpm_inhale` together against `sampled_at`, so the lag
  is visible rather than hidden.
- The Ready preview wave is the commanded shape, label it "Commanded", not airflow.
- The team decision pending is whether heavy mode becomes free flow (continuous flow = π × VE,
  EN 13274-3). Do not hard-code heavy as a breath preset yet.

## 6. Sensor columns are empty, show that

Since blower-0.5 the firmware does not send `co2_ppm`, `temp_c` or `rh_pct` (sensors not wired
yet). All 3,870 rows today have them null. `toTelemetry()` turns null into `0`, so the app shows
0 ppm CO2 and 0 °C as if measured. Keep null as null (`number | null`) and show
"Not connected" the same way tidal volume shows "Not measured yet". Same for `rpm_exhale`
(second blower not wired yet).

## 7. Read `duty_cmd`

Add `duty_cmd` to `TELEMETRY_COLUMNS` and `TelemetryRow` (`dutyCmd: number | null`). Use it for
the live chart, the band, CSV (`Duty (%)`) and the assistant ("time in each band", "rpm lag").

## 8. Demo backend

`RPM_PER_DUTY = 70` is wrong for this rig at 15 V. Measured steady state: 19 % 2,460, 30 % 4,965,
50 % ~9,100, 70 % 13,545, 100 % 20,100. Use that table (linear interpolation), add the ~0.6 s lag
and a coast-down of ~2,500 rpm/s, and emit the free phases, so demo runs look like real ones.

## 9. Old rows

50 rows from 06:10 UTC today have no `sampled_at` (one batch from firmware 0.6 before the fix).
`toTelemetry` already drops them. No action needed. Firmware 0.7 cannot produce them.

## Acceptance checks

1. Free flow 50 %. Device shows running, recording starts, rpm settles ~9,000 to 9,100, band
   "Walking / light". Stop. `runs` row has `mode = 'free'`, `bpm` null.
2. Free flow 10 %. Running with banner "Below 19 %. No flow", rpm 0.
3. Breath 15 bpm, 50 %, I:E 1:2. The `commands` row params include `ie_ratio: 2`. Phase shows 1.33 s
   inhale, 2.67 s exhale.
4. CO2, temperature and humidity show "Not connected", not 0.
