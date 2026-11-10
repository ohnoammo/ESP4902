# CB360 thermal camera: protocol and app integration

Written 2026-10-29 from the vendor app **CB360 2.0.12** (`com.parts.mobileir.CB360`, a Guide
"MobIR" module app), decompiled for interoperability. Not yet tested against the real camera:
everything below comes from the vendor app's code and must be confirmed once the camera arrives
(see "Checks when the camera arrives").

## Hardware and USB

| | |
|---|---|
| USB IDs | vendor `0x0525`, product `0xA4A0` or `0xA4A1` |
| Interface | the one whose **alternate setting 1** has exactly two **bulk** endpoints (one IN, one OUT); claim it and select alt setting 1 |
| Reads | bulk IN, 16 384 bytes per transfer, 100 ms timeout |
| Commands | plain ASCII written to bulk OUT |

Commands (all ASCII, no terminator):

| Command | Bytes | Effect |
|---|---|---|
| Start stream | `StartX=1` | camera starts sending frames |
| Stop stream | `StopX=1` | stops |
| Shutter recalibration (NUC) | `DoNUC=1` | shutter closes briefly; image re-levels |
| Shutter | `ShutterOn=1`, `ShutterOff=1`, `ShutterStop=1` | |
| One header row | `GetParamLine=1` | |
| Read flash | `GetArmParam=` + 3 × int16 LE (page, offset, length) | calibration curve pages 462–486, per-pixel K pages 300–461, serial number page 489 (14 bytes) |
| Factory reset | `ResetFactory=1` | **don't send** |

## Frame format

25 frames/s. One frame = **120 × 93 little-endian uint16** = 22 320 bytes:

- Row 0: header ("param line"). Word 0 is the frame mark `0xAA55`.
- Rows 1–90: the image, 120 × 90 raw detector counts ("Y16"). Higher = warmer.
- Rows 91–92: reference rows (not shown).

Reads don't line up with frames. The vendor app buffers them and accepts a frame only when it starts
on `0xAA55` and the next frame does too (`src/thermal/protocol.ts` → `FrameAssembler`).

Header words used (index → meaning):

| Word | Meaning | Conversion (from the vendor app) |
|---|---|---|
| 0 | frame mark | `0xAA55` |
| 1 | USB firmware version | |
| 2, 3 | video width, height | |
| 4–8 | device name, 2 ASCII chars per word (low byte first) | first 5 chars = `CB360` |
| 9 | shutter temperature | `T = −4.0235e-11·x³ + 1.218402729e-6·x² − 0.018218076216914·x + 127.361304901973` |
| 10 | lens temperature | same polynomial |
| 11 | detector (FPA) temperature | `T = (338180000 − 18181.804·x) / 1e6` |
| 12 | shutter state | |
| 48–55 | user settings: range, emissivity (50 low byte), humidity, distance, env. temp, brightness/contrast, palette, Hz | |
| 72–88 | calibration coefficients (KS, K0–K5, near/far B and KF, TREF) | |

## Temperatures

The image arrives as raw counts. The vendor app converts counts to °C in its closed native library
(`libNativeCore.so`: `realTimeGetTemp`, `getTemperatureByY16`) using the camera's calibration curve
(1 700 points, apparently −20 to 150 °C in 0.1 °C steps), per-pixel K table and the header coefficients.
That conversion is **not reproduced** in our app.

Instead, the app uses a **two-point calibration made by the team**: aim the crosshair at two references
of known temperature (at least 5 °C apart, e.g. ice water and a warm object checked with a thermometer)
and the app fits a straight line from counts to °C. Every °C shown traces back to those references.
Redo it if the camera has warmed up a lot or after a long session.

Leak detection does **not** need °C (see below).

## What the app does (`src/thermal`, `src/state/ThermalContext.tsx`, `src/screens/ThermalScreen.tsx`)

- **Connection:** WebUSB, so it runs in **Chrome** (Android phone with the camera on USB-C, or a
  laptop). Expo Go can't reach USB devices; a native Android module would be needed for that.
  Windows laptops may need the WinUSB driver bound to the camera (e.g. with Zadig).
- **Picture:** 120 × 90, auto-contrast with a smoothed range (widens at once, narrows over ~3 s),
  warmest/coolest markers, crosshair. Demo mode has a simulated head and mask with a leak.
- **Palettes:** the CB360 app's nine (`res/raw/palette0–8.raw`, BGRA, 256 colours), names from its
  menu (matched to tables by eye): White hot, Iron red, Hot iron, Lava, Rainbow 2, Rainbow 1, Tint,
  Rainbow, Black hot.
- **Leak / hotspot detection:** each pixel keeps a resting level (follows cooling fast, warming slowly,
  ~8 s). A patch of ≥ 12 pixels rising above its resting level by the sensitivity threshold, held for
  3 frames, raises "Possible leak". It shows on the camera page and on the live Running screen, with a
  1 s vibration (and a tone on the web).
- **Sensitivity:** a slider (40–400 counts above resting level, shown in °C once calibrated) with three
  tappable recommendations: Low 300 (only clear leaks), Medium 150 (most tests), High 80 (small leaks,
  may react to warm air near the mask). Tune these once the camera is here.
- **Event log:** each alert (start, end, worst value) and each stretch the camera was streaming is
  logged with timestamps on the phone (`thermal.events.<mode>`, last 1 000). A run shows the events in
  its own time window ("Thermal camera" card on the run page), and the CSV gets two columns per second:
  `Thermal camera` (`watching` or blank) and `Thermal alert` (`leak`, `high`, `low`). A blank camera
  column means the camera wasn't watching, so no alert there doesn't mean no leak. In live mode each
  event is also written to the Supabase `thermal_events` table (when it starts and when it ends), so
  any phone opening the run sees it; alert pictures stay on the phone that took them.
- **Temperature alarms:** high and low limits with on/off switches, like the CB360 app (same defaults:
  off, 120 °C, −20 °C). Need the calibration. Alerts repeat every 10 s while active.
- The camera keeps streaming when you leave its page, so alerts keep working during a run.
- **No input:** the page shows "No input" with the reason: CB360 not detected (not plugged in, or
  never allowed in this browser), unplugged mid-stream, connected but no frames for 2 s, or the
  header doesn't name a CB360. A CB360 allowed before is found and connected without the picker.
- **From the CB360 app also:** temperature unit (°C/°F/K), tap the picture to place a measuring spot,
  isotherm (paints everything at or above a set temperature green; default 36 °C), lock colours
  (freeze the colour range, like manual brightness/contrast), save picture, and an automatic picture
  when an alert starts (kept with the event on the phone, last 20).
- **Not included:** video recording, fusion with the phone's camera, emissivity/distance/humidity
  correction (these tune the CB360's own on-board °C, which this app doesn't use), the album and
  cloud album, accounts.

## Checks when the camera arrives

1. Connect in Chrome; confirm frames arrive (fps on the page) and the header name reads `CB360`.
2. Compare the sensor/lens/shutter temperatures with the CB360 app.
3. Do the two-point calibration; check a third reference against both our app and the CB360 app.
4. Breathe through a badly fitted mask on the headform and tune the leak sensitivity defaults.
5. If counts per °C differ a lot from ~55–60, update the comment in `src/thermal/detect.ts`.
