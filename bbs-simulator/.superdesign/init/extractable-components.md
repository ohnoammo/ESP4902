# Extractable components

## TabBar
- Source: `src/navigation/TabBar.tsx`
- Category: layout
- Description: White bottom bar with three navy circle icons (Home, Sessions, Settings); the active tab rises into a notch with an orange label
- Extractable props: activeItem (string, default: "home")
- Hardcoded: icon SVGs, labels, notch shape

## DemoBanner
- Source: `src/components/AppBanners.tsx`
- Category: layout
- Description: Yellow strip "DEMO · simulated data" above every screen in demo mode
- Extractable props: none
- Hardcoded: text, colours

## BandPill
- Source: `src/components/BandPill.tsx`
- Category: basic
- Description: Outlined pill with a level-coloured dot and the duty band label, optional open-air note
- Extractable props: label (string), level (string: ok|info|warn|error)
- Hardcoded: styles

## SegmentedToggle
- Source: `src/components/controls.tsx`
- Category: basic
- Description: Rounded segmented control (e.g. Breathing / Free flow)
- Extractable props: options, value
- Hardcoded: styles
