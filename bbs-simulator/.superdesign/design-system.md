# BBS Simulator: design system

## Product
A phone app (iOS/Android/web, 393pt frame) for a lab team running a breathing simulator: an ESP32
blower pushes air through a headform to test masks. Users pick or build a "simulator" preset
(breathing pattern or fixed free flow), start it on the device, watch live telemetry and review runs.
Users are engineering students and lab staff: they need numbers they can trust, plainly labelled.

## Visual language (keep the current style)
- Dark first. Background deep navy #191629; cards #31394D with 1px #262D3D border, radius 24–30.
- Text #F2F5FF, strong #FFFFFF, muted #98A0B8. Labels 14 bold muted, sentence case.
- One accent: orange #ECA269 (primary pill buttons with navy text, selected states, links).
  Selected state = orange 2px border + accentTint rgba(236,162,105,.25) fill.
- Status colours used only for meaning: success #28AB6B, warning #F5C24C, danger #D54E62, info #8FB0FF.
- Helvetica. Hero 45 bold, title 34 bold, heading 22 bold, body 16, meta 14 muted, button 15 bold.
- Pills fully rounded. Segmented toggle 56 tall radius 28. Sliders: thin track, orange fill, white thumb.
- Flat: no gradients, no glow, shadows only on dialogs/toasts. Generous vertical rhythm (24–32).
- Insets 37 for text, 24 for cards. Tap targets ≥ 44.

## Content rules
- Plain, short wording; units always shown (bpm, %, L/min, rpm); spaces before % in prose ("50 %").
- Never show a made-up physiological number. Values the team has not sourced are shown as a visible
  placeholder ("Source pending") rather than invented.
- Warnings explain and never block Start; only missing required values block Save.
- Duty bands (15 V, open air): <19 no flow · 19–36 below human range · 36–64 Walking / light ·
  64–72 between modes · 72–88 Heavy · 88–100 above heavy · 100 saturated.
- Demo mode shows a yellow "DEMO · simulated data" strip on every screen.
