# BBS Simulator app

Expo (React Native) app built from the Figma file `JfWxkv5xgVps0wns8xesbb`, using
bbs-control as the behavioural reference. It runs on iOS/Android (Expo Go) and on the web.

```bash
npm install
cp .env.example .env    # then fill in the Supabase URL and PUBLISHABLE key
npx expo start          # scan the QR code with Expo Go, or press w for web
```

The real device is reached through the ESP4902 Supabase project (tables, rules and the run
lifecycle are in **DEVICE_INTEGRATION.md**). Without a `.env`, only demo mode works.

## Flow

Welcome → **Connect** (the real device, via Supabase) or **Try demo mode** (built-in simulation) →
tabs: **Home** (simulators), **Sessions**, **Settings**.

- **Demo mode** shows a yellow "DEMO · simulated data" banner on every screen. Demo runs are
  stored under their own keys and never listed with real runs (and vice versa).
- **Device state** comes only from the device: *online* = heartbeat (`device_status.last_seen`)
  within 15 s; *running* = the newest telemetry row's phase isn't `idle`. Start is disabled while a
  start is pending, while the device is offline, or while it is already running. Stop is never
  disabled. All times are shown in Singapore time.

- **Home:** a simulator is a preset of respiratory rate (5–40 bpm) and blower power (0–100 %);
  I:E is fixed at 1:1 by the current firmware. Tap one (Ready), then **Start**: recording begins
  when the telemetry shows the device breathing, and ends on **Stop** or when the device reports
  idle (e.g. its failsafe, ~10 s after losing the network). The live view charts the last 20 s of
  fan RPM; tidal volume and peak pressure show "Not measured yet". **Details** shows the live
  sensors (CO2 in %, from ppm; a warning above 45 000 ppm, where the MH-Z16 nears saturation).
  Swipe a simulator card left to delete it.
- **Stop** saves the run and opens it in Sessions: Graph/Table, sensor chips, min/avg/max,
  rename (pencil icon), Export CSV.
- **Sessions:** swipe a run left to delete it. Hold a run and drag it to reorder it or drop it
  onto a folder. Inside a folder, drag a run up onto "Move to All runs" to take it out.
  Hold a folder (or use "Delete folder") to delete it; its runs move back to All runs.
  **Compare** lets you pick 2–5 runs to compare.
- **Assistant:** "Ask" on Sessions (or "Ask about this run" on a run) opens a chat that answers
  from the saved readings: summaries, comparisons, highest/lowest across runs, drift and
  CO2-saturation checks. It is rule-based (`src/utils/assistant.ts`), not an LLM.
- **Text size:** the round "Aa" button at the top right of Home, Sessions and Settings (also
  Settings → Text size): Small / Default / Large / Largest, applied live while the dialog is
  open. Only font sizes change, never layout; 30pt+ display text stays fixed and nothing
  drops below 12pt.

## Where things live

| Path | What |
| --- | --- |
| `src/device/` | Device layer: `supabaseBackend` (real device) and `demoBackend` (simulation) behind one interface. **See DEVICE_INTEGRATION.md.** |
| `src/lib/supabase.ts` | Supabase client, configured from `.env` (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`). |
| `src/state/DeviceContext.tsx` | Connection, 60 s rolling telemetry buffer (re-renders ~3×/s), online/running state, commands. |
| `src/state/RunContext.tsx` | Run lifecycle: Start/Stop commands, recording begins/ends from telemetry phase. |
| `src/state/DataContext.tsx` | Simulator presets, runs and folders per mode (AsyncStorage). |
| `src/utils/telemetry.ts` | 10 Hz rows → 1 s samples; CO2 ppm/% and the saturation threshold. |
| `src/mock/breathing.ts` | Idealised breathing curve for the Ready preview and Home cards. |
| `src/assets/svgs.ts` | Icons exported from Figma. |
| `src/navigation/TabBar.tsx` | Custom nav bar with the notched active tab. |
| `src/theme.ts` | Dark (Figma) and light palettes, fonts, `themedStyles`, `fs()` text scaling. Wrap every new `fontSize` in `fs()` or it won't follow Text size. |

Telemetry arrives at 10 Hz and is shown as 1 s averages (fan speeds on the Sensors screen show
the newest reading, since the fans alternate by phase). Live runs keep only their time range and
settings on the phone and fetch readings from Supabase when opened; demo runs store their 1 s
samples on the phone. CSV export has one row per second with times in SGT and CO2 in ppm.

## Guesses made where the prototype wasn't wired

- Stop goes straight to the saved recording. Recording continues while you browse other tabs.
- The Loading wave "breathes" (grows and flattens) while it connects, following the six Loading frames.
- Light mode (Settings → Appearance: Dark / Light) has no frames; it mirrors the dark design with navy ink on a pale page.
- Settings and the table view had no frames, so they reuse the existing card, list and dialog styles.
- Compare takes 2–5 runs (Figma shows 2; with 3+ the table lists one row per run), has sensor chips (the frame only shows temperature), and export writes a single CSV
  with a `Run` column.
