# Pages (dependency trees)

## Home/NewSimulator (target of the preset redesign)
Entry: src/screens/NewSimulatorScreen.tsx
Dependencies:
- src/components/basics.tsx
- src/components/controls.tsx (Slider, SegmentedToggle)
- src/components/BandPill.tsx
  - src/constants/dutyBands.ts
- src/constants/dutyBands.ts (breathLimitation)
- src/device/types.ts (ranges)
- src/state/DataContext.tsx
  - src/constants/presets.ts
- src/theme.ts
- src/utils/format.ts

## Home/Simulators
Entry: src/screens/SimulatorsScreen.tsx
Dependencies:
- src/components/basics.tsx
- src/components/ActiveRunBanner.tsx
- src/components/DeviceStatus.tsx
- src/components/SwipeToDelete.tsx
- src/components/controls.tsx (TextSizeButton)
- src/components/waves.tsx (MiniBreathWave)
  - src/mock/breathing.ts
- src/components/BandPill.tsx
- src/theme.ts

## Home/Ready
Entry: src/screens/ReadyScreen.tsx
Dependencies:
- src/components/basics.tsx
- src/components/waves.tsx (BreathWave)
- src/components/DeviceStatus.tsx
- src/components/BandPill.tsx
- src/constants/dutyBands.ts
- src/theme.ts

## Home/Running
Entry: src/screens/RunningScreen.tsx
Dependencies:
- src/components/basics.tsx
- src/components/waves.tsx (LineGraph)
- src/components/DeviceStatus.tsx
- src/components/BandPill.tsx
- src/theme.ts
