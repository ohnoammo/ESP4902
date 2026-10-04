import { Platform, StyleSheet, TextStyle } from 'react-native';

export type Scheme = 'dark' | 'light';

// Dark is the Figma design; every value there is lifted from the file.
const dark = {
  scheme: 'dark' as Scheme,
  background: '#191629',
  card: '#31394D',
  cardBorder: '#262D3D',
  pressed: '#211E36',
  text: '#F2F5FF',
  strong: '#FFFFFF', // headings/labels and waveform lines that sit directly on the background
  onAccent: '#FFFFFF', // text on orange/red buttons, identical in both themes
  muted: '#98A0B8',
  subtle: 'rgba(255,255,255,0.75)',
  loadingMuted: 'rgba(255,255,255,0.41)',
  accent: '#ECA269',
  accentText: '#ECA269', // orange used as text (links, hints)
  accentTint: 'rgba(236,162,105,0.25)',
  accentDark: '#CB5A03',
  danger: '#D54E62',
  dangerText: '#3A0F17',
  success: '#28AB6B',
  inputBorder: '#646F8A',
  dialogBorder: '#3A4152',
  segmentActive: '#19223A',
  divider: '#31394D',
  dividerDim: '#262D3D',
  chevron: '#80869D',
  swipeCancel: '#2B3241',
  sliderTrack: '#262D3D',
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
  text: '#191629',
  strong: '#191629',
  onAccent: '#FFFFFF',
  muted: '#646C85',
  subtle: 'rgba(25,22,41,0.62)',
  loadingMuted: 'rgba(25,22,41,0.5)',
  accent: '#ECA269',
  accentText: '#B45F16',
  accentTint: 'rgba(236,162,105,0.22)',
  accentDark: '#CB5A03',
  danger: '#D54E62',
  dangerText: '#3A0F17',
  success: '#1E8A55',
  inputBorder: '#B9C0D0',
  dialogBorder: '#E1E4EC',
  segmentActive: '#E7E9F1',
  divider: '#E1E4EC',
  dividerDim: '#E8EAF0',
  chevron: '#9AA1B5',
  swipeCancel: '#E7E9F1',
  sliderTrack: '#E1E4EC',
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
};

export const palettes: Record<Scheme, Colors> = { dark, light };

// The design is set in Helvetica. iOS ships it; web falls back through the stack;
// Android has no Helvetica, so it uses the system sans at the same weights.
const family = Platform.select({
  ios: 'Helvetica',
  web: 'Helvetica, "Helvetica Neue", Arial, sans-serif',
  default: undefined,
});

export const font = {
  regular: { fontFamily: family, fontWeight: '400' } as TextStyle,
  bold: { fontFamily: family, fontWeight: '700' } as TextStyle,
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
    hero: { ...font.bold, fontSize: fs(45), color: c.text } as TextStyle,
    title: { ...font.bold, fontSize: fs(34), color: c.text } as TextStyle,
    heading: { ...font.bold, fontSize: fs(22), color: c.text } as TextStyle,
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
export function themedStyles<T extends StyleSheet.NamedStyles<T>>(factory: () => T & StyleSheet.NamedStyles<any>): T {
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

// Horizontal insets used throughout the Figma frames (393pt wide).
export const inset = {
  text: 37,
  card: 24,
};

// The 45pt hero title fits ~10 characters on a 393pt screen; longer user-entered
// names step down instead of truncating.
export function heroSize(text: string): number {
  if (text.length <= 10) return 45;
  if (text.length <= 14) return 36;
  return 30;
}
