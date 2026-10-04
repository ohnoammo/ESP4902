# BBS Simulator app

Expo (React Native) app built from the Figma file `JfWxkv5xgVps0wns8xesbb`, using
bbs-control as the behavioural reference. It runs on iOS/Android (Expo Go) and on the web.

```bash
npm install
npx expo start          # scan the QR code with Expo Go, or press w for web
```

## Flow

Welcome → Connect (loading) → tabs: **Home** (simulators), **Sessions**, **Settings**.

- **Home:** tap a simulator to open it (Ready), then **Start**. The run records until you tap **Stop**,
  even if you leave the screen; a "Recording" banner on each tab takes you back to it.
  **Details** shows the live sensors. Swipe a simulator card left to delete it.
- **Stop** saves the run and opens it in Sessions: Graph/Table, sensor chips, min/avg/max,
  rename (pencil icon), Export CSV.
- **Sessions:** swipe a run left to delete it. Hold a run and drag it to reorder it or drop it
  onto a folder. Inside a folder, drag a run up onto "Move to All runs" to take it out.
  Hold a folder (or use "Delete folder") to delete it; its runs move back to All runs.
  **Compare** lets you pick 2–5 runs to compare.
- **Assistant:** "Ask" on Sessions (or "Ask about this run" on a run) opens a chat that answers
  from the saved readings: summaries, comparisons, highest/lowest across runs, drift and
  tidal-volume-vs-target checks. It is rule-based (`src/utils/assistant.ts`), not an LLM.
- **Text size:** the round "Aa" button at the top right of Home, Sessions and Settings (also
  Settings → Text size): Small / Default / Large / Largest, applied live while the dialog is
  open. Only font sizes change, never layout; 30pt+ display text stays fixed and nothing
  drops below 12pt.

## Where things live

| Path | What |
| --- | --- |
| `src/device/` | Device layer: simulator or ESP32 over WebSocket. **See DEVICE_INTEGRATION.md.** |
| `src/mock/breathing.ts` | Simulated breathing waveform + sensor readings. |
| `src/state/` | Connection, data (AsyncStorage persistence) and active-run contexts. |
| `src/assets/svgs.ts` | Icons exported from Figma. |
| `src/navigation/TabBar.tsx` | Custom nav bar with the notched active tab. |
| `src/theme.ts` | Dark (Figma) and light palettes, fonts, `themedStyles`, `fs()` text scaling. Wrap every new `fontSize` in `fs()` or it won't follow Text size. |

Data is saved on the device (AsyncStorage). Each run is sampled once per second.

## Guesses made where the prototype wasn't wired

- Stop goes straight to the saved recording. Recording continues while you browse other tabs.
- The Loading wave "breathes" (grows and flattens) while it connects, following the six Loading frames.
- Light mode (Settings → Appearance: Dark / Light) has no frames; it mirrors the dark design with navy ink on a pale page.
- Settings and the table view had no frames, so they reuse the existing card, list and dialog styles.
- Compare takes 2–5 runs (Figma shows 2; with 3+ the table lists one row per run), has sensor chips (the frame only shows temperature), and export writes a single CSV
  with a `Run` column.
