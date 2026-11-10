import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton, Field, LinkText, LiveDot, PrimaryButton, Screen, useTopInset } from '../components/basics';
import { SegmentedToggle, Slider, TextSizeButton } from '../components/controls';
import { StateBanner } from '../components/BandPill';
import { backLabel } from '../components/ToolLinks';
import { Reveal } from '../components/motion';
import { HomeStackParams } from '../navigation/types';
import { useDevice } from '../state/DeviceContext';
import { ThermalInput, useThermal, useThermalAlert } from '../state/ThermalContext';
import { fs, colors, font, themedStyles, type } from '../theme';
import { formatNumber } from '../utils/format';
import { IMAGE_ROWS, WIDTH } from '../thermal/protocol';
import { PALETTES } from '../thermal/palettes';
import { Palette, Rotation, View as FrameView, frameToBmp, bmpToDataUri, makeView, paletteColor } from '../thermal/render';
import { Calibration, RECOMMENDED, THRESHOLD_MAX, THRESHOLD_MIN, countsPerC, toCelsius } from '../thermal/detect';
import { webUsbAvailable } from '../thermal/source';
import { saveSnapshot } from '../thermal/snapshot';
import { TempUnit, UNIT_LABEL, fmtRise, fmtTemp, fromC, toC } from '../thermal/units';

// Share of the gap the display range closes per redraw when it narrows (about 3 s to settle).
const RANGE_EASE = 0.04;
const ISO_RGB: [number, number, number] = [0, 255, 140]; // isotherm colour: not in any palette

// Why there's no picture, in words, for the "No input" panel.
function noInputReason(input: ThermalInput, opts: { webUsb: boolean; present: boolean; connecting: boolean }): string {
  if (!opts.webUsb) return 'USB cameras can only be reached from Chrome. Open the web version of this app in Chrome, on the phone or a laptop.';
  if (opts.connecting) return 'Connecting to the CB360…';
  if (input === 'stalled') return 'The CB360 is connected but isn’t sending a picture. Unplug it and plug it back in, or tap Shutter recalibrate.';
  if (input === 'wrongDevice') return 'This USB device isn’t a CB360.';
  if (opts.present) return 'CB360 found. Tap Connect camera.';
  return 'CB360 not detected. Plug it into this device’s USB-C port, then tap Connect camera (the first time, choose it in Chrome’s list).';
}

// Live view from the CB360 thermal camera for spotting air leaking around the mask: warm
// exhaled air shows as a bright plume at the mask edge, and the app flags it (see ThermalContext).
// °C needs the team's two-point calibration; until then the picture and leak alerts still work.
export function ThermalScreen({ navigation }: NativeStackScreenProps<HomeStackParams, 'Thermal'>) {
  const top = useTopInset();
  const insets = useSafeAreaInsets();
  const { mode } = useDevice();
  const demo = mode === 'demo';
  const t = useThermal();
  const alert = useThermalAlert();
  const { snapshot, settings, calibration: cal } = t;
  const u = settings.unit;
  const live = t.status === 'live';
  const hasInput = live && t.input === 'ok' && !!snapshot;
  const webUsb = demo || webUsbAvailable();
  const [locked, setLocked] = useState(false);
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 });

  // Demo mode has no device picker, and a CB360 allowed before needs none: connect straight away.
  useEffect(() => {
    if (t.status === 'idle' && (demo || t.present)) t.connect();
  }, [demo, t.present]);

  // Smoothed auto-range: widens at once, narrows slowly, so a breath's warm plume shows
  // against a steady scale instead of the picture re-levelling every frame. "Lock colours"
  // freezes it (the CB360's manual brightness/contrast).
  const range = useRef<{ min: number; max: number } | null>(null);
  if (!snapshot) range.current = null;
  let bmp: Uint8Array | null = null;
  if (snapshot && hasInput) {
    const { min, max } = snapshot.stats;
    const r = range.current ?? { min, max };
    if (!locked) {
      r.min = min < r.min ? min : r.min + (min - r.min) * RANGE_EASE;
      r.max = max > r.max ? max : r.max + (max - r.max) * RANGE_EASE;
    }
    range.current = r;
    const iso = settings.isoOn && cal ? { counts: cal.a.counts + (settings.isoC - cal.a.c) * countsPerC(cal), rgb: ISO_RGB } : null;
    bmp = frameToBmp(snapshot.frame.y16, r.min, r.max, settings.palette, iso, settings.rotation, settings.smooth ? SMOOTH_SCALE : 1);
  }
  // The picture as shown (rotated); markers, the warm-patch box and taps use it.
  const view = makeView(settings.rotation);
  const h = snapshot?.frame.header;
  const temp = (counts: number) => (cal ? fmtTemp(toCelsius(cal, counts), u) : '–');
  const spotIndex = spot ? spot.y * WIDTH + spot.x : null;

  const onTapImage = (e: any) => {
    if (!frameSize.w) return;
    const vx = Math.min(view.w - 1, Math.max(0, Math.floor((e.nativeEvent.locationX / frameSize.w) * view.w)));
    const vy = Math.min(view.h - 1, Math.max(0, Math.floor((e.nativeEvent.locationY / frameSize.h) * view.h)));
    const [x, y] = view.fromView(vx, vy); // the spot is kept in camera pixels, so rotating keeps it
    setSpot({ x, y });
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: top + 8, paddingBottom: 16 }}>
        <BackButton label={backLabel(navigation.getState())} onPress={() => navigation.goBack()} />
        <Reveal index={0}>
          <View style={styles.titleRow}>
            <Text style={[type.title, styles.titleText]} accessibilityRole="header">
              Thermal camera
            </Text>
            <TextSizeButton />
          </View>
          <View style={styles.statusRow} accessibilityLiveRegion="polite">
            {hasInput && <LiveDot />}
            <Text style={styles.status}>
              {hasInput
                ? `${demo ? 'Simulated camera' : h?.deviceName ?? 'CB360'} · ${snapshot?.fps ?? 0} fps`
                : t.status === 'connecting'
                  ? 'Connecting…'
                  : demo || t.present
                    ? 'CB360 detected · not connected'
                    : 'No CB360 detected'}
            </Text>
          </View>
        </Reveal>
        {alert && hasInput && <StateBanner text={alert.text} level={alert.kind === 'leak' ? 'warn' : 'error'} style={styles.alert} />}

        <Reveal index={1} style={styles.frameBox}>
          {hasInput && bmp && snapshot ? (
            <Pressable
              onPress={onTapImage}
              onLayout={(e) => setFrameSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
              style={[styles.frame, { aspectRatio: view.w / view.h }]}
              accessibilityRole="image"
              accessibilityLabel={`Thermal image, brighter is warmer.${snapshot.hotspot ? ' A warm patch is highlighted.' : ''} Tap to measure a spot.`}
            >
              <Image source={{ uri: bmpToDataUri(bmp) }} style={styles.image} resizeMode="stretch" />
              {snapshot.hotspot && <HotspotBox h={snapshot.hotspot} view={view} />}
              <Marker index={snapshot.stats.maxAt} kind="hot" view={view} />
              <Marker index={snapshot.stats.minAt} kind="cold" view={view} />
              {spotIndex !== null ? (
                <Marker index={spotIndex} kind="spot" view={view} label={cal ? temp(snapshot.frame.y16[spotIndex]) : 'spot'} />
              ) : (
                <View style={styles.crosshair} pointerEvents="none" />
              )}
            </Pressable>
          ) : (
            <View style={[styles.frame, { aspectRatio: view.w / view.h }, styles.empty]} accessibilityLiveRegion="polite">
              <Text style={styles.noInput} accessibilityRole="header">
                No input
              </Text>
              <Text style={styles.emptyText}>
                {noInputReason(t.input, { webUsb, present: demo || t.present, connecting: t.status === 'connecting' })}
              </Text>
            </View>
          )}
          {hasInput && (
            <View style={styles.scale}>
              <View style={styles.scaleBar}>
                {Array.from({ length: 24 }, (_, i) => (
                  <View key={i} style={{ flex: 1, backgroundColor: paletteColor(settings.palette, i / 23) }} />
                ))}
              </View>
              <View style={styles.scaleLabels}>
                <Text style={styles.scaleText}>{cal && range.current ? temp(range.current.min) : 'Coolest in view'}</Text>
                <Text style={styles.scaleText}>{cal && range.current ? temp(range.current.max) : 'Warmest in view'}</Text>
              </View>
            </View>
          )}
          {hasInput && (
            <View style={styles.imageActions}>
              <PrimaryButton label="Save picture" icon="save" variant="outline" onPress={() => bmp && saveSnapshot(bmp)} style={styles.half} />
              <PrimaryButton label={locked ? 'Unlock colours' : 'Lock colours'} icon={locked ? 'unlock' : 'lock'} variant="outline" onPress={() => setLocked(!locked)} style={styles.half} />
            </View>
          )}
          {hasInput && (
            <View style={styles.imageActions}>
              <PrimaryButton
                label={`Rotate · ${settings.rotation}°`}
                icon="refresh"
                variant="outline"
                onPress={() => t.updateSettings({ rotation: (((settings.rotation + 90) % 360) as Rotation) })}
                style={styles.half}
              />
              <PrimaryButton
                label={settings.smooth ? 'Smooth: on' : 'Smooth: off'}
                icon={settings.smooth ? 'check' : undefined}
                variant="outline"
                onPress={() => t.updateSettings({ smooth: !settings.smooth })}
                style={styles.half}
              />
            </View>
          )}
          {spot && hasInput && <LinkText label="Clear measuring spot" size={16} onPress={() => setSpot(null)} />}
        </Reveal>

        <Reveal index={2}>
          <Text style={styles.section}>Colour palette</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.palettes}>
            {PALETTES.map((p) => (
              <PaletteChip key={p.key} palette={p.key} name={p.name} selected={settings.palette === p.key} onPress={() => t.updateSettings({ palette: p.key })} />
            ))}
          </ScrollView>
        </Reveal>

        <Reveal index={3} style={styles.card}>
          <Text style={styles.cardTitle}>Temperatures</Text>
          <SegmentedToggle
            options={[
              { key: 'C', label: '°C' },
              { key: 'F', label: '°F' },
              { key: 'K', label: 'K' },
            ]}
            value={u}
            onChange={(unit: TempUnit) => t.updateSettings({ unit })}
          />
          <Row label="Warmest spot" value={hasInput && cal ? temp(snapshot!.stats.max) : '–'} />
          <Row label="Coolest spot" value={hasInput && cal ? temp(snapshot!.stats.min) : '–'} />
          <Row label={spot ? 'Measuring spot' : 'Crosshair'} value={hasInput && cal ? temp(spotIndex !== null ? snapshot!.frame.y16[spotIndex] : snapshot!.stats.center) : '–'} />
          {!cal && <Text style={styles.note}>Spot temperatures need a quick two-point calibration (below).</Text>}
          <View style={styles.rule} />
          <ToggleRow label="Isotherm highlight" value={settings.isoOn} disabled={!cal} onChange={(v) => t.updateSettings({ isoOn: v })} />
          {settings.isoOn && cal && <LimitField valueC={settings.isoC} unit={u} onChange={(c) => t.updateSettings({ isoC: c })} label="Highlight above" />}
          <Text style={styles.note}>
            {cal ? 'Paints everything at or above the set temperature bright green.' : 'The isotherm works once the camera is calibrated.'}
          </Text>
          <View style={styles.rule} />
          <Text style={styles.cardSub}>Camera internal</Text>
          <Row label="Sensor" value={h && hasInput ? fmtTemp(h.sensorC, u) : '–'} />
          <Row label="Lens" value={h && hasInput ? fmtTemp(h.lensC, u) : '–'} />
          <Row label="Shutter" value={h && hasInput ? fmtTemp(h.shutterC, u) : '–'} />
        </Reveal>

        <Reveal index={4} style={styles.card}>
          <Text style={styles.cardTitle}>Alerts</Text>
          <ToggleRow label="Leak detection" value={settings.leakOn} onChange={(v) => t.updateSettings({ leakOn: v })} />
          {settings.leakOn && <SensitivitySlider threshold={settings.leakThreshold} cal={cal} unit={u} onChange={(n) => t.updateSettings({ leakThreshold: n })} />}
          <View style={styles.rule} />
          <ToggleRow label="High temperature alarm" value={settings.highOn} disabled={!cal} onChange={(v) => t.updateSettings({ highOn: v })} />
          {settings.highOn && cal && <LimitField valueC={settings.high} unit={u} onChange={(c) => t.updateSettings({ high: c })} label="Alarm above" />}
          <ToggleRow label="Low temperature alarm" value={settings.lowOn} disabled={!cal} onChange={(v) => t.updateSettings({ lowOn: v })} />
          {settings.lowOn && cal && <LimitField valueC={settings.low} unit={u} onChange={(c) => t.updateSettings({ low: c })} label="Alarm below" />}
          <Text style={styles.note}>
            {cal
              ? 'When an alert starts the phone vibrates and the picture is saved with the run, like the CB360 app’s alarm photo.'
              : 'Temperature alarms work once the camera is calibrated.'}
          </Text>
        </Reveal>

        <Reveal index={5} style={styles.card}>
          <CalibrationCard demo={demo} />
        </Reveal>

        {t.error && (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {t.error}
          </Text>
        )}
      </ScrollView>

      {!demo && (
        <View style={[styles.actions, { marginBottom: Math.max(insets.bottom, 20) + 8 }]}>
          {live ? (
            <>
              <PrimaryButton label="Recalibrate" icon="refresh" variant="outline" onPress={t.recalibrateShutter} style={styles.half} />
              <PrimaryButton label="Disconnect" icon="unplug" variant="outline" onPress={t.disconnect} style={styles.half} />
            </>
          ) : (
            <PrimaryButton
              label={t.status === 'connecting' ? 'Connecting…' : 'Connect camera'}
              icon="plug"
              onPress={t.connect}
              disabled={!webUsb}
              loading={t.status === 'connecting'}
              style={styles.half}
            />
          )}
        </View>
      )}
    </Screen>
  );
}

// Leak sensitivity on a slider (right = more sensitive, i.e. a smaller rise sets it off), with
// the recommended Low / Medium / High points marked and tappable.
function SensitivitySlider({ threshold, cal, unit, onChange }: { threshold: number; cal: Calibration | null; unit: TempUnit; onChange: (n: number) => void }) {
  const flip = (n: number) => THRESHOLD_MIN + THRESHOLD_MAX - n; // threshold ↔ slider position
  const pct = (n: number) => ((flip(n) - THRESHOLD_MIN) / (THRESHOLD_MAX - THRESHOLD_MIN)) * 100;
  const nearest = RECOMMENDED.reduce((a, b) => (Math.abs(b.counts - threshold) < Math.abs(a.counts - threshold) ? b : a));
  const onMark = Math.abs(nearest.counts - threshold) <= 5;
  const rise = cal ? fmtRise(threshold / countsPerC(cal), unit) : `${threshold} counts`;
  return (
    <View>
      <View style={styles.sensHead}>
        <Text style={styles.fieldLabel}>Sensitivity</Text>
        <Text style={styles.sensValue}>{onMark ? nearest.label : 'Custom'}</Text>
      </View>
      <Slider
        value={flip(threshold)}
        min={THRESHOLD_MIN}
        max={THRESHOLD_MAX}
        step={5}
        onChange={(v) => onChange(flip(v))}
        accessibilityLabel={`Leak sensitivity: alerts at ${rise} above resting level`}
      />
      <View style={styles.marks}>
        {RECOMMENDED.map((r) => (
          <Pressable
            key={r.key}
            onPress={() => onChange(r.counts)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Set ${r.label} sensitivity, recommended`}
            style={[styles.mark, { left: `${pct(r.counts)}%` }]}
          >
            <View style={[styles.tick, onMark && nearest.key === r.key && styles.tickOn]} />
            <Text style={[styles.markText, onMark && nearest.key === r.key && styles.markTextOn]}>{r.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.sensEnds}>
        <Text style={styles.endText}>Fewer alerts</Text>
        <Text style={styles.endText}>Smaller leaks</Text>
      </View>
      <Text style={styles.note}>
        Alerts when a patch warms {rise} above its resting level, like exhaled air escaping past the seal.{' '}
        {onMark ? nearest.hint : `Nearest recommendation: ${nearest.label}. ${nearest.hint}`}
      </Text>
    </View>
  );
}

// Two references of known temperature, each read off the crosshair, give the counts → °C line.
function CalibrationCard({ demo }: { demo: boolean }) {
  const t = useThermal();
  const cal = t.calibration;
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [refC, setRefC] = useState('');
  const [first, setFirst] = useState<Calibration['a'] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const record = () => {
    const c = Number(refC.replace(',', '.'));
    const counts = t.sampleCentre();
    if (!refC.trim() || !Number.isFinite(c)) return setProblem('Enter the reference temperature in °C.');
    if (counts === null) return setProblem('No picture from the camera yet.');
    setProblem(null);
    setRefC('');
    if (step === 1) {
      setFirst({ counts, c });
      setStep(2);
      return;
    }
    if (!first) return;
    if (Math.abs(c - first.c) < 5) return setProblem('Use two references at least 5 °C apart.');
    if (Math.abs(counts - first.counts) < 50) return setProblem('The camera sees both points as the same. Aim the crosshair at each reference.');
    const [a, b] = first.c < c ? [first, { counts, c }] : [{ counts, c }, first];
    t.saveCalibration({ a, b, at: Date.now() });
    setStep(0);
    setFirst(null);
  };

  return (
    <>
      <Text style={styles.cardTitle}>Calibration</Text>
      {step === 0 ? (
        <>
          <Text style={styles.body}>
            {cal
              ? cal.at
                ? `Calibrated ${new Date(cal.at).toLocaleString()} from ${formatNumber(cal.a.c, 1)} °C and ${formatNumber(cal.b.c, 1)} °C references.`
                : 'The simulated camera comes calibrated.'
              : 'Not calibrated. Aim the crosshair at two references of known temperature, such as ice water and a warm object checked with a thermometer.'}
          </Text>
          <View style={styles.calActions}>
            <LinkText label={cal ? 'Calibrate again' : 'Calibrate'} size={15} onPress={() => setStep(1)} />
            {cal && !(demo && !cal.at) && <LinkText label="Clear" size={15} color={colors.muted} onPress={t.clearCalibration} />}
          </View>
        </>
      ) : (
        <>
          <Text style={styles.body}>
            {step === 1 ? 'Point 1: aim the crosshair at the first reference.' : `Point 2: aim at a second reference, at least 5 °C from ${formatNumber(first!.c, 1)} °C.`}
          </Text>
          <Field value={refC} onChangeText={setRefC} placeholder="Reference °C" keyboardType="numbers-and-punctuation" style={styles.calField} accessibilityLabel={`Reference ${step} temperature`} />
          {problem && <Text style={styles.problem}>{problem}</Text>}
          <View style={styles.calActions}>
            <LinkText label={`Record point ${step}`} size={15} onPress={record} />
            <LinkText label="Cancel" size={15} color={colors.muted} onPress={() => { setStep(0); setFirst(null); setProblem(null); }} />
          </View>
        </>
      )}
    </>
  );
}

// A temperature limit typed in the chosen unit, stored in °C.
function LimitField({ valueC, unit, onChange, label }: { valueC: number; unit: TempUnit; onChange: (c: number) => void; label: string }) {
  const shown = () => String(Math.round(fromC(valueC, unit)));
  const [text, setText] = useState(shown());
  useEffect(() => setText(shown()), [unit, valueC]);
  const commit = () => {
    const n = Number(text.replace(',', '.'));
    if (Number.isFinite(n)) onChange(toC(n, unit));
    else setText(shown());
  };
  return (
    <View style={styles.limit}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Field value={text} onChangeText={setText} onEndEditing={commit} onBlur={commit} keyboardType="numbers-and-punctuation" style={styles.limitField} accessibilityLabel={`${label}, ${UNIT_LABEL[unit]}`} />
      <Text style={styles.rowLabel}>{UNIT_LABEL[unit]}</Text>
    </View>
  );
}

function ToggleRow({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={() => !disabled && onChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      style={[styles.toggleRow, disabled && styles.dim]}
    >
      <Text style={styles.toggleLabel}>{label}</Text>
      <View style={[styles.switch, value && !disabled && styles.switchOn]}>
        <View style={[styles.knob, value && !disabled && styles.knobOn]} />
      </View>
    </Pressable>
  );
}

function PaletteChip({ palette, name, selected, onPress }: { palette: Palette; name: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name} palette`}
      accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.chipOn]}
    >
      <View style={styles.chipBar}>
        {Array.from({ length: 12 }, (_, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: paletteColor(palette, i / 11) }} />
        ))}
      </View>
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{name}</Text>
    </Pressable>
  );
}

function HotspotBox({ h, view }: { h: { x0: number; y0: number; x1: number; y1: number }; view: FrameView }) {
  // The box's corners in the rotated picture.
  const [ax, ay] = view.toView(h.x0, h.y0);
  const [bx, by] = view.toView(h.x1, h.y1);
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
  return (
    <View
      pointerEvents="none"
      style={[
        styles.hotspot,
        {
          left: `${(x0 / view.w) * 100}%`,
          top: `${(y0 / view.h) * 100}%`,
          width: `${((x1 - x0 + 1) / view.w) * 100}%`,
          height: `${((y1 - y0 + 1) / view.h) * 100}%`,
        },
      ]}
    >
      <Text style={styles.hotspotText}>warm patch</Text>
    </View>
  );
}

function Marker({ index, kind, label, view }: { index: number; kind: 'hot' | 'cold' | 'spot'; label?: string; view: FrameView }) {
  const [vx, vy] = view.toView(index % WIDTH, Math.floor(index / WIDTH));
  const x = (vx + 0.5) / view.w;
  const y = (vy + 0.5) / view.h;
  const ring = kind === 'hot' ? '#FFFFFF' : kind === 'cold' ? colors.seriesA : ISO_RGB_CSS;
  return (
    <View pointerEvents="none" style={[styles.marker, { left: `${x * 100}%`, top: `${y * 100}%` }]}>
      <View style={[styles.markerRing, { borderColor: ring }, kind === 'spot' && styles.spotRing]} />
      <Text style={styles.markerText}>{label ?? (kind === 'hot' ? 'warmest' : 'coolest')}</Text>
    </View>
  );
}

// Smoothing enlarges the 120 × 90 frame this many times (360 × 270), interpolating counts.
const SMOOTH_SCALE = 3;

const ISO_RGB_CSS = `rgb(${ISO_RGB.join(',')})`;

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label} ${value}`}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, muted && styles.rowMuted]}>{value}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingLeft: 40, paddingRight: 24, marginTop: 8 },
  titleText: { flexShrink: 1, fontSize: 30, letterSpacing: -0.8 }, // one line beside the Aa button
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 40, marginTop: 4 },
  status: { ...font.regular, fontSize: fs(14), color: colors.muted },
  alert: { marginHorizontal: 24, marginTop: 16 },
  frameBox: { marginHorizontal: 24, marginTop: 24 },
  frame: { aspectRatio: WIDTH / IMAGE_ROWS, borderRadius: 24, overflow: 'hidden', backgroundColor: '#000000' },
  image: { width: '100%', height: '100%' },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
  noInput: { ...font.displayHeavy, fontSize: fs(28), color: colors.strong, marginBottom: 8 },
  imageActions: { flexDirection: 'row', gap: 12, marginTop: 16, marginBottom: 8 },
  emptyText: { ...font.regular, fontSize: fs(15), lineHeight: fs(22), color: colors.muted, textAlign: 'center' },
  crosshair: { position: 'absolute', left: '50%', top: '50%', width: 16, height: 16, marginLeft: -8, marginTop: -8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)', borderRadius: 8 },
  marker: { position: 'absolute', alignItems: 'center', width: 64, marginLeft: -32, marginTop: -8 },
  markerRing: { width: 16, height: 16, borderRadius: 8, borderWidth: 2 },
  spotRing: { width: 20, height: 20, borderRadius: 10, borderWidth: 3 },
  markerText: { ...font.bold, fontSize: 13, color: '#FFFFFF', marginTop: 2, textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 3 },
  hotspot: { position: 'absolute', borderWidth: 2, borderColor: colors.warning, borderRadius: 4 },
  hotspotText: { ...font.bold, position: 'absolute', top: -16, left: 0, fontSize: 11, color: colors.warning, textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 3 },
  scale: { marginTop: 12 },
  scaleBar: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden' },
  scaleLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  scaleText: { ...font.mono, fontSize: fs(13), color: colors.muted },
  section: { ...font.bold, fontSize: fs(16), color: colors.muted, marginHorizontal: 40, marginTop: 24 },
  palettes: { gap: 8, paddingHorizontal: 24, paddingTop: 8 },
  chip: { width: 112, minHeight: 56, padding: 8, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
  chipOn: { borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.accentTint },
  chipBar: { flexDirection: 'row', height: 16, borderRadius: 4, overflow: 'hidden' },
  chipText: { ...font.regular, fontSize: fs(14), color: colors.text, marginTop: 4 },
  chipTextOn: { ...font.bold, color: colors.accentText },
  card: { marginHorizontal: 24, marginTop: 24, padding: 24, borderRadius: 24, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
  cardTitle: { ...font.bold, fontSize: fs(16), color: colors.muted, marginBottom: 8 },
  cardSub: { ...font.bold, fontSize: fs(13), color: colors.muted, marginTop: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  rowLabel: { ...font.regular, fontSize: fs(16), color: colors.muted },
  rowValue: { ...font.monoBold, fontSize: fs(17), letterSpacing: -0.4, color: colors.strong },
  rowMuted: { ...font.bold, fontSize: fs(15), letterSpacing: 0, color: colors.muted },
  rule: { height: 1, backgroundColor: colors.dividerDim, marginVertical: 12 },
  note: { ...font.regular, fontSize: fs(15), lineHeight: fs(22), color: colors.muted, marginTop: 8 },
  body: { ...font.regular, fontSize: fs(16), lineHeight: fs(23), color: colors.text },
  fieldLabel: { ...font.bold, fontSize: fs(16), color: colors.text, marginTop: 8, marginBottom: 8 },
  sensHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sensValue: { ...font.bold, fontSize: fs(16), color: colors.accentText },
  marks: { height: 40, marginTop: 4 },
  mark: { position: 'absolute', width: 72, marginLeft: -36, minHeight: 40, alignItems: 'center' },
  tick: { width: 2, height: 8, borderRadius: 1, backgroundColor: colors.muted },
  tickOn: { backgroundColor: colors.accent, height: 12 },
  markText: { ...font.regular, fontSize: fs(15), color: colors.muted, marginTop: 2 },
  markTextOn: { ...font.bold, color: colors.accentText },
  sensEnds: { flexDirection: 'row', justifyContent: 'space-between' },
  endText: { ...font.regular, fontSize: fs(14), color: colors.muted },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  toggleLabel: { ...font.regular, fontSize: fs(16), color: colors.text, flex: 1 },
  dim: { opacity: 0.45 },
  switch: { width: 48, height: 28, borderRadius: 14, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.inputBorder, padding: 2 },
  switchOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.muted },
  knobOn: { backgroundColor: colors.onAccent, transform: [{ translateX: 20 }] },
  limit: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 8 },
  limitField: { width: 96, height: 40 },
  calField: { marginTop: 12 },
  calActions: { flexDirection: 'row', gap: 24, marginTop: 12 },
  problem: { ...font.regular, fontSize: fs(15), color: colors.dangerInk, marginTop: 8 },
  error: { ...font.regular, fontSize: fs(13), lineHeight: fs(18), color: colors.dangerInk, marginHorizontal: 40, marginTop: 16 },
  actions: { flexDirection: 'row', gap: 12, marginHorizontal: 24, marginTop: 12 },
  half: { flex: 1, marginHorizontal: 0 },
}));
