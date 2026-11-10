import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from 'react-native';

export type Scheme = 'dark' | 'light';

// Dark is the Figma design; every value there is lifted from the file.
const dark = {
  scheme: 'dark' as Scheme,
  background: '#191629',
  card: '#31394D',
  cardBorder: '#262D3D',
  pressed: '#211E36',
  // Secondary (outline) buttons sit on this, so they read as buttons against the page and cards.
  raised: '#4C5778',
  text: '#F2F5FF',
  strong: '#FFFFFF', // headings/labels and waveform lines that sit directly on the background
  // Navy on orange (white on #ECA269 is ~2.1:1, below WCAG AA); white stays on red.
  onAccent: '#191629',
  onDanger: '#FFFFFF',
  muted: '#A4ACC2', // 5.1:1 on cards (the Figma #98A0B8 was 4.4:1, under AA for small text)
  subtle: 'rgba(255,255,255,0.75)',
  loadingMuted: 'rgba(255,255,255,0.41)',
  accent: '#ECA269',
  accentText: '#ECA269', // orange used as text (links, hints)
  accentTint: 'rgba(236,162,105,0.25)',
  accentDark: '#CB5A03',
  // Fill for Stop/Delete: white on it is 5.2:1 (the Figma #D54E62 was 4.1:1).
  danger: '#C23B50',
  // Red as text or outline: 5.1:1 on cards, 7.9:1 on the page. Red means error/Delete only.
  dangerInk: '#FF8A99',
  success: '#28AB6B',
  inputBorder: '#7A84A0', // field and switch outlines: 3.1:1 on cards, 4.7:1 on the page
  dialogBorder: '#3A4152',
  segmentActive: '#19223A',
  divider: '#31394D',
  dividerDim: '#262D3D',
  chevron: '#80869D',
  swipeCancel: '#2B3241',
  sliderTrack: '#7A84A0', // the unfilled track must be visible (3:1) on cards and the page
  sliderThumb: '#FFF8EA',
  progressTrack: '#939393',
  dashed: '#E0E0E0',
  folderDim: '#1B2130',
  seriesA: '#8FB0FF',
  seriesB: '#F4A8D4',
  // Extra compare lines (beyond Figma's two), matched in lightness to seriesA/B.
  seriesC: '#8FE3B4',
  seriesD: '#F5D27A',
  seriesE: '#C4A8FF',
  backdrop: 'rgba(0,0,0,0.55)',
  gridLine: 'rgba(152,160,184,0.22)', // faint version of `muted`, for graph gridlines
  navBar: '#FFFFFF',
  navLabel: '#CB5A03',
  // Demo-mode banner: loud on purpose, identical in both themes.
  demo: '#F5C24C',
  onDemo: '#191629',
  warning: '#F5C24C',
};

export type Colors = typeof dark;

// Light has no Figma frames: same structure, with the dark navy as ink on a pale
// cool-grey page and white cards. Orange text and chart lines are darkened for contrast.
const light: Colors = {
  scheme: 'light',
  background: '#F3F4F8',
  card: '#FFFFFF',
  cardBorder: '#E1E4EC',
  pressed: '#E8EAF1',
  raised: '#FFFFFF',
  text: '#191629',
  strong: '#191629',
  onAccent: '#191629',
  onDanger: '#FFFFFF',
  muted: '#646C85',
  subtle: 'rgba(25,22,41,0.62)',
  loadingMuted: 'rgba(25,22,41,0.5)',
  accent: '#ECA269',
  accentText: '#B45F16',
  accentTint: 'rgba(236,162,105,0.22)',
  accentDark: '#CB5A03',
  danger: '#C23B50',
  dangerInk: '#B3263C',
  success: '#1E8A55',
  inputBorder: '#8B93A8', // 3.1:1 on white cards
  dialogBorder: '#E1E4EC',
  segmentActive: '#E7E9F1',
  divider: '#E1E4EC',
  dividerDim: '#E8EAF0',
  chevron: '#9AA1B5',
  swipeCancel: '#E7E9F1',
  sliderTrack: '#8B93A8',
  sliderThumb: '#FFFFFF',
  progressTrack: '#D6DAE4',
  dashed: '#AEB5C6',
  folderDim: '#ECEEF3',
  seriesA: '#3F6FE0',
  seriesB: '#D04F9A',
  seriesC: '#239A60',
  seriesD: '#C28A06',
  seriesE: '#7B55E0',
  backdrop: 'rgba(25,22,41,0.4)',
  gridLine: 'rgba(100,108,133,0.25)',
  // Inverted nav: navy bar (circles/notch take the page grey, see TabBar navXml).
  navBar: '#191629',
  navLabel: '#ECA269', // the darker Figma orange is too dim on the navy bar
  demo: '#F5C24C',
  onDemo: '#191629',
  warning: '#9A6A00',
};

export const palettes: Record<Scheme, Colors> = { dark, light };

// Bench-instrument type: Bricolage Grotesque for display, Martian Mono for live readouts
// (fixed-width, so updating numbers don't jitter), Instrument Sans for everything else.
// Each weight is its own family (loaded in App.tsx via FONT_FILES); no fontWeight, which
// would make web synthesise bold on top of the bold file.
export const FONT_FILES = {
  InstrumentSans_400Regular: require('@expo-google-fonts/instrument-sans/400Regular/InstrumentSans_400Regular.ttf'),
  InstrumentSans_700Bold: require('@expo-google-fonts/instrument-sans/700Bold/InstrumentSans_700Bold.ttf'),
  BricolageGrotesque_700Bold: require('@expo-google-fonts/bricolage-grotesque/700Bold/BricolageGrotesque_700Bold.ttf'),
  BricolageGrotesque_800ExtraBold: require('@expo-google-fonts/bricolage-grotesque/800ExtraBold/BricolageGrotesque_800ExtraBold.ttf'),
  MartianMono_400Regular: require('@expo-google-fonts/martian-mono/400Regular/MartianMono_400Regular.ttf'),
  MartianMono_600SemiBold: require('@expo-google-fonts/martian-mono/600SemiBold/MartianMono_600SemiBold.ttf'),
};

export const font = {
  regular: { fontFamily: 'InstrumentSans_400Regular' } as TextStyle,
  bold: { fontFamily: 'InstrumentSans_700Bold' } as TextStyle,
  display: { fontFamily: 'BricolageGrotesque_700Bold' } as TextStyle,
  displayHeavy: { fontFamily: 'BricolageGrotesque_800ExtraBold' } as TextStyle,
  mono: { fontFamily: 'MartianMono_400Regular' } as TextStyle,
  monoBold: { fontFamily: 'MartianMono_600SemiBold' } as TextStyle,
};

// Text size (Settings → Text size). Only font sizes scale, never layout. Display text
// (30pt and up: titles, the clock) is already large and sized to fit the 393pt frames,
// so it stays put; everything else scales, never dropping below 12pt.
export const TEXT_SCALES = [0.9, 1, 1.15, 1.3] as const;
export const TEXT_SCALE_LABELS = ['Small', 'Default', 'Large', 'Largest'];
let textScale = 1;

export function fs(size: number): number {
  if (size >= 30) return size;
  return Math.max(Math.min(size, 12), Math.round(size * textScale));
}

function buildType(c: Colors) {
  return {
    // Display sizes are tracked in tight so they read as headlines, not document text.
    hero: { ...font.displayHeavy, fontSize: fs(45), letterSpacing: -1.4, color: c.text } as TextStyle,
    title: { ...font.displayHeavy, fontSize: fs(34), letterSpacing: -0.9, color: c.text } as TextStyle,
    heading: { ...font.display, fontSize: fs(22), letterSpacing: -0.3, color: c.text } as TextStyle,
    back: { ...font.bold, fontSize: fs(16), color: c.muted } as TextStyle,
    label: { ...font.bold, fontSize: fs(14), color: c.muted } as TextStyle,
    body: { ...font.regular, fontSize: fs(16), color: c.text } as TextStyle,
    meta: { ...font.regular, fontSize: fs(14), color: c.muted } as TextStyle,
    button: { ...font.bold, fontSize: fs(15), color: c.onAccent } as TextStyle,
  };
}

// `colors` and `type` are live objects: applyTheme() rewrites them in place, and the
// navigator is remounted (ThemeContext), so everything reads the new values on its next render.
export const colors: Colors = { ...dark };
export const type = buildType(dark);
let themeVersion = 0;

export function applyTheme(scheme: Scheme) {
  if (colors.scheme === scheme) return;
  Object.assign(colors, palettes[scheme]);
  Object.assign(type, buildType(colors));
  themeVersion++;
}

export function applyTextScale(scale: number) {
  if (textScale === scale) return;
  textScale = scale;
  Object.assign(type, buildType(colors));
  themeVersion++;
}

// Drop-in for StyleSheet.create whose values may read `colors`/`type`: the sheet is
// rebuilt lazily the first time it is read after a theme change.
// StyleSheet.NamedStyles is no longer exported (React Native 0.88).
type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

export function themedStyles<T extends NamedStyles<T>>(factory: () => T & NamedStyles<any>): T {
  let sheet: T | null = null;
  let builtFor = -1;
  return new Proxy({} as T, {
    get(_, key) {
      if (builtFor !== themeVersion || !sheet) {
        sheet = StyleSheet.create(factory());
        builtFor = themeVersion;
      }
      return (sheet as Record<string | symbol, unknown>)[key];
    },
  });
}

// Recolours fill/stroke attributes of a Figma SVG string (all swaps happen at once,
// so {white: navy, navy: white} inverts cleanly). Keys are matched case-insensitively.
export function recolor(xml: string, map: Record<string, string>): string {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return xml.replace(/(fill|stroke)="([^"]+)"/g, (m, attr, value) =>
    lower[value.toLowerCase()] ? `${attr}="${lower[value.toLowerCase()]}"` : m
  );
}

// Spacing scale: every margin, padding and gap is one of these. An 8pt rhythm, with 4 and
// 12 as half-steps for tight pairs (a label under its value, chips in a row).
export const space = [4, 8, 12, 16, 24, 32, 40, 48, 64] as const;

// Horizontal insets: text sits 40 from the screen edge, cards 24.
export const inset = {
  text: 40,
  card: 24,
};

// The 45pt hero title fits ~10 characters on a 393pt screen; longer user-entered
// names step down instead of truncating.
export function heroSize(text: string): number {
  if (text.length <= 10) return 45;
  if (text.length <= 14) return 36;
  return 30;
}
