# Design and readability changes (October 2026)

Written 2026-10-25. Summarises the design pass on the app: what changed and why. Behaviour
(device control, recording, Supabase, demo mode) is unchanged except where noted.

How it was checked: a design review of the running app (demo mode, web, phone-sized window),
a TypeScript check, and a walk through Welcome, Home, Ready, Running, Session, Sessions and
Settings after each pass. Not yet tested on a real phone in Expo Go.

## 1. Safety and readability fixes

| Change | Why |
|---|---|
| **Stop is pinned** to the bottom of the Running screen instead of sitting at the end of the scroll. | It stops a physical blower. On a phone it was below the fold, and nobody should have to scroll for it. |
| **Navy text on orange buttons** (Connect, Start, Export CSV), not white. | White on the orange was 2.1:1 contrast; the WCAG minimum is 4.5:1. Navy is about 8.4:1. Our own design notes already asked for navy. |
| **Darker red fill** for Stop and Delete, with white text. | White on the old red was 4.1:1 (just under the minimum); now 5.2:1. The dark text on swipe-Delete was 3.2:1. |
| **Lighter red for red text and outlines** (Offline, errors, "No flow", Delete folder), as a separate `dangerInk` colour. | The old red was only 2.8:1 on cards, and these are the messages you can't afford to miss. Now 5.1:1 on cards, 7.9:1 on the page. |
| **Red means error or Delete only.** The recording dot is now a pulsing white dot, always next to the word "Recording". | Patient monitors keep red for alarms and never signal by colour alone. A red recording dot read as an error. |
| **Fixed-width digits for every live number** (clock, rpm, duty, stats, run banner, min/avg/max). | Proportional digits change width as values update, so the numbers jittered sideways. |

## 2. Layout and hierarchy

| Change | Why |
|---|---|
| **Home: "Your simulators" first**, activity presets below. | The three presets still say "Source pending" and can't be run, but they filled the first screen while the simulators you can start were below the fold. |
| **Ready: settings grouped in one card**, muted labels, bold values. | Each setting had its own tall card with the label louder than the number. The value is what you check before Start, and the shorter screen brings Start up. |
| **Running: "Tidal volume and peak pressure: not measured yet"** as one quiet line. | A row of dashes took prime space for values that are never measured. |
| **Session: Ask and rename moved up beside the back link**; the selected sensor chip is an orange outline, not a solid fill. | The title wrapped onto two lines, and three orange elements competed. Export CSV is now the only filled orange. |
| **Welcome: "Try demo mode" is a full-width outlined button** with "Simulated data, no device needed" under it. | It was a small grey link, but it's the main way in without the device. |

## 3. CO2 and humidity removed

Leaks are now checked with a thermal camera instead, so CO2 and humidity are gone from the
sensor chips, the live Sensors screen, the CO2 saturation warnings and the assistant. The
database fields and CSV columns are unchanged, so older runs keep their readings in exports;
new runs leave those columns blank. The thermal camera isn't wired in yet (see "Next").

## 4. New look: fonts and motion

| Change | Why |
|---|---|
| **Bricolage Grotesque** for titles, **Martian Mono** for live numbers, **Instrument Sans** for body text (replacing Helvetica). | Helvetica made the app look stock. The mono font makes readings look like an instrument panel and gives the fixed-width digits above. Text values like "Free flow" stay in the sans so they don't look like code. |
| **One staggered fade-in per screen**, a slight press-down on buttons, a slow pulse on the recording dot. All under 300 ms except the pulse, and all off when the phone's Reduce Motion setting is on. | Only a few things animated before. One orchestrated entrance reads better than scattered effects, and Apple's guidelines ask apps to respect Reduce Motion. |

Fonts are loaded in `App.tsx` before the app shows (falls back to the system font on error).
Packages added: `expo-font`, `@expo-google-fonts/bricolage-grotesque`, `martian-mono`,
`instrument-sans`. Motion uses React Native's built-in `Animated` (`src/components/motion.tsx`).

The gradient/pattern backgrounds suggested by the frontend-aesthetics prompt were left out on
purpose: the design notes say flat, and a busy background would compete with the live charts.

## 5. Spacing scale

Every margin, padding and gap now uses one scale, `space` in `src/theme.ts`:
**4 / 8 / 12 / 16 / 24 / 32 / 40 / 48 / 64** (an 8 px rhythm with 4 and 12 as half-steps).
Before, the app used about 45 different values (37, 33, 26, 17, 11 …). 236 were snapped to the
nearest step. Text now sits 40 from the screen edge (was 37). A single scale makes screens
feel calmer and keeps new screens consistent: pick values from `space`.

## Next

- **Thermal camera:** depends on the model. A temperature-grid sensor such as the MLX90640 on
  the ESP32 would fit best: it could send readings to Supabase with the telemetry and show a
  small heat map on the Running screen.
- **Card alignment:** text inside cards starts at 48 from the edge, text outside at 40. Card
  side padding of 16 would line them up.
- **High-contrast mode** for bright benches, and keeping orange out of status messages (some
  "info" pills still use it).
