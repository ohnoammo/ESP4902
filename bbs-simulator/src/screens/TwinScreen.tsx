import React, { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Svg, { Circle, Ellipse, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { BackButton, PrimaryButton, Screen, useTopInset } from '../components/basics';
import { Slider, TextSizeButton } from '../components/controls';
import { DeviceStatusLine } from '../components/DeviceStatus';
import { backLabel } from '../components/ToolLinks';
import { Reveal, useReduceMotion } from '../components/motion';
import { GraphSeries, LineGraph, useFrameClock } from '../components/waves';
import {
  DEFAULT_PRESET_KEY,
  FAULT_LABEL,
  flowCheck,
  PEAK_STATUS_LABEL,
  peakFlow,
  peakStatus,
  Q_MAX_IN,
  TRIM_LIMIT,
  TWIN_PRESETS,
  TWIN_SOURCES,
  VT_RANGE,
} from '../constants/twin';
import { BPM_RANGE, StartParams, TelemetryRow, TwinSample, validateStart } from '../device/types';
import { HomeStackParams } from '../navigation/types';
import { useDevice } from '../state/DeviceContext';
import { useRun } from '../state/RunContext';
import { fs, colors, font, themedStyles, type } from '../theme';
import { formatNumber } from '../utils/format';

// Same full-scale rpm as the live chart (100 % duty, 15 V, open air).
const MAX_RPM = 20100;

// Digital twin: the rig drawn as a schematic (blower → hose → headform and mask), driven by
// live telemetry, then the twin as live plots:
//   flow      signed target vs estimated airflow (installed calibration at the measured rpm),
//             + inhale, − exhale, over the last few breaths; overlap = breath delivered
//   rpm       measured vs expected rpm, and the learned trim (the only real measurement)
// plus a status strip (phase, fan fault, calibration validity) and the flow-breath controls.
// Rows only carry twin values on twin firmware; on 0.7 the page says so instead.
export function TwinScreen({ navigation }: NativeStackScreenProps<HomeStackParams, 'Twin'>) {
  const top = useTopInset();
  const { latest, stale, buffer, version, mode, deviceStatus, online, running, sendCommand } = useDevice();
  const { active } = useRun();
  const fresh = !!latest && !stale;
  const duty = fresh && latest.dutyCmd !== null ? latest.dutyCmd : null;
  const rpm = fresh ? activeRpm(latest) : null;
  const phase = fresh ? latest.phase : null;
  const twin = fresh ? latest.twin : null;
  const twinFirmware = mode === 'demo' || /twin/i.test(deviceStatus?.firmware ?? '') || !!twin;

  // Plot window: the last WINDOW_S seconds of rows that carry the twin.
  const plots = useMemo(() => {
    const rows = buffer.current;
    const end = rows.length ? rows[rows.length - 1].sampledAt : Date.now();
    const from = end - WINDOW_S * 1000;
    const tgt: GraphSeries = { t: [], v: [], color: colors.seriesA };
    const est: GraphSeries = { t: [], v: [], color: colors.accent };
    const rpmM: GraphSeries = { t: [], v: [], color: colors.accent };
    const rpmE: GraphSeries = { t: [], v: [], color: colors.seriesA };
    let driven = 0;
    let calibrated = 0;
    for (const r of rows) {
      if (r.sampledAt < from || !r.twin) continue;
      const t = (r.sampledAt - from) / 1000;
      const sign = r.phase === 'exhale' ? -1 : 1; // inhale +, exhale −
      if (r.twin.qTarget !== null) push(tgt, t, sign * r.twin.qTarget);
      if (r.twin.qTwin !== null) push(est, t, sign * r.twin.qTwin);
      push(rpmM, t, activeRpm(r));
      if (r.twin.rpmExpected !== null) push(rpmE, t, r.twin.rpmExpected);
      if ((r.dutyCmd ?? 0) > 0 && r.twin.valid !== null) {
        driven++;
        if (r.twin.valid) calibrated++;
      }
    }
    return {
      flow: [tgt, est].filter((s) => s.v.length),
      rpm: [rpmE, rpmM].filter((s) => s.v.length),
      // Share of the window (fan on) with the fan at or above the calibration table's first
      // speed. Flow passes through 0 at each phase switch, so this is steadier than the flag.
      calibratedPct: driven ? Math.round((100 * calibrated) / driven) : null,
    };
  }, [version]);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: top + 8, paddingBottom: 48 }}>
        <BackButton label={backLabel(navigation.getState())} onPress={() => navigation.goBack()} />
        <Reveal index={0}>
          <View style={styles.titleRow}>
            <Text style={[type.title, styles.titleText]} accessibilityRole="header">
              Digital twin
            </Text>
            <TextSizeButton />
          </View>
          <DeviceStatusLine style={styles.status} />
          {active && <Text style={styles.sub}>{active.simulator.name}</Text>}
        </Reveal>

        <Reveal index={1}>
          <TwinStatus phase={phase} twin={twin} duty={duty} calibratedPct={plots.calibratedPct} />
        </Reveal>

        <Reveal index={2} style={styles.card}>
          <RigSchematic rpm={rpm ?? 0} duty={duty ?? 0} phase={phase} qTwin={twin?.qTwin ?? null} />
          <FlowReadout fresh={fresh} phase={phase} duty={duty} qTwin={twin?.qTwin ?? null} />
        </Reveal>

        <Reveal index={3}>
          <SectionHead
            title="Flow"
            hint="Above 0 is inhale (inhale fan), below 0 is exhale (exhale fan). Overlap means the device is delivering the breath you asked for."
          />
          <Legend
            items={[
              { label: 'Target', color: colors.seriesA },
              { label: 'Estimated airflow (installed calibration)', color: colors.accent },
            ]}
          />
          {plots.flow.length ? (
            <View style={styles.graph}>
              <LineGraph series={plots.flow} duration={WINDOW_S} height={200} unit="L/min" xLabels={[`−${WINDOW_S} s`, 'now']} />
            </View>
          ) : (
            <EmptyPlot text={twinFirmware ? 'Start a flow breath to see target and estimated airflow.' : NO_TWIN_TEXT} />
          )}
        </Reveal>

        <Reveal index={4}>
          <SectionHead
            title="Blower speed"
            hint="The one real measurement. The trim nudges duty until measured meets expected, and keeps what it learns between breaths."
          />
          <Legend items={[{ label: 'Expected', color: colors.seriesA }, { label: 'Measured', color: colors.accent }]} />
          {plots.rpm.length ? (
            <View style={styles.graph}>
              <LineGraph series={plots.rpm} duration={WINDOW_S} height={200} unit="rpm" xLabels={[`−${WINDOW_S} s`, 'now']} />
            </View>
          ) : (
            <EmptyPlot text={twinFirmware ? 'Start a flow breath to see measured and expected rpm.' : NO_TWIN_TEXT} />
          )}
          {twin?.trim != null && (
            <Text style={Math.abs(twin.trim) >= TRIM_LIMIT ? styles.badNote : styles.note}>
              Learned trim {twin.trim >= 0 ? '+' : '−'}
              {formatNumber(Math.abs(twin.trim), 1)} % duty (limit ±{TRIM_LIMIT} %)
            </Text>
          )}
        </Reveal>

        <Reveal index={5} style={styles.columns}>
          <View style={styles.column}>
            <Text style={styles.colTitle}>Measured</Text>
            <Value label="Duty" value={duty === null ? '–' : `${formatNumber(duty, 0)} %`} />
            <Value label="Blower" value={rpm === null ? '–' : `${formatNumber(rpm, 0)} rpm`} />
            <Value label="Flow" value="No sensor" muted />
          </View>
          <View style={styles.column}>
            <Text style={styles.colTitle}>Twin model</Text>
            <Value label="Target flow" value={twin?.qTarget != null ? `${formatNumber(twin.qTarget, 1)} L/min` : '–'} />
            <Value label="Estimated airflow" value={twin?.qTwin != null ? `${formatNumber(twin.qTwin, 1)} L/min` : '–'} />
            <Value label="Expected blower" value={twin?.rpmExpected != null ? `${formatNumber(twin.rpmExpected, 0)} rpm` : '–'} />
            <Value
              label="Learned trim"
              value={twin?.trim != null ? `${twin.trim >= 0 ? '+' : '−'}${formatNumber(Math.abs(twin.trim), 1)} %` : '–'}
            />
          </View>
        </Reveal>

        <Reveal index={6}>
          <FlowControls
            enabled={twinFirmware}
            online={online}
            running={running}
            firmware={deviceStatus?.firmware ?? null}
            sendCommand={sendCommand}
          />
        </Reveal>

        <Reveal index={7}>
          <SectionHead title="Where these numbers come from" hint="" />
          {TWIN_SOURCES.map((t, i) => (
            <Text key={i} style={styles.source}>
              {'• '}
              {t}
            </Text>
          ))}
        </Reveal>
      </ScrollView>
    </Screen>
  );
}

// About three breaths at 12 bpm, more at faster rates.
const WINDOW_S = 15;
const LOW_CALIBRATED_PCT = 50;
const NO_TWIN_TEXT = 'The device runs firmware without the twin, so there is nothing to plot yet.';

function push(s: GraphSeries, t: number, v: number) {
  s.t.push(t);
  s.v.push(v);
}

// RPM of the fan driving this half: the exhale fan on exhale when it has a tach, else the
// inhale fan (one blower driving both halves).
const activeRpm = (r: TelemetryRow) => (r.phase === 'exhale' && r.rpmExhale !== null ? r.rpmExhale : r.rpmInhale);

// Phase, fault and calibration validity at a glance. Fault is the one that needs action.
function TwinStatus({
  phase,
  twin,
  duty,
  calibratedPct,
}: {
  phase: string | null;
  twin: TwinSample | null;
  duty: number | null;
  calibratedPct: number | null;
}) {
  const fault = twin?.fault ?? null;
  const invalid = twin?.valid === false && (duty ?? 0) > 0;
  return (
    <View style={styles.statusRow}>
      <Chip label="Phase" value={phase ? phaseLabel(phase) : '–'} tone="muted" />
      <Chip
        label="Fan"
        value={fault === null ? '–' : FAULT_LABEL[fault]}
        tone={fault === null ? 'muted' : fault === 0 ? 'ok' : fault === 3 ? 'warn' : 'bad'}
      />
      <Chip
        label="Calibration"
        value={!twin ? '–' : invalid ? 'Below table' : 'In table'}
        tone={!twin ? 'muted' : invalid ? 'warn' : 'ok'}
      />
      {calibratedPct !== null && (
        <Text style={calibratedPct < LOW_CALIBRATED_PCT ? styles.warnText : styles.hintText}>
          {calibratedPct}% of the last {WINDOW_S} s had the fan inside the installed calibration (25 % duty or faster).
          {calibratedPct < LOW_CALIBRATED_PCT ? ' The estimate is scaled below that, so it is less certain for most of this breath.' : ''}
        </Text>
      )}
      {fault === 3 && (
        <Text style={styles.warnText}>
          The target is above this fan’s capacity, so it is held at 100 % and the peak is clipped.
        </Text>
      )}
      {fault === 1 && <Text style={styles.badText}>The fan is driven but the tach reads 0: stalled, or a wiring fault.</Text>}
      {fault === 2 && (
        <Text style={styles.badText}>
          The trim is at its ±{TRIM_LIMIT} % limit: the fan can’t reach the speed it needs (low battery or a worn fan).
        </Text>
      )}
    </View>
  );
}

const phaseLabel = (p: string) =>
  p === 'inhale' ? 'Inhale' : p === 'exhale' ? 'Exhale' : p === 'idle' ? 'Idle' : p.replace('_', ' ');

function Chip({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }) {
  const color = tone === 'ok' ? colors.success : tone === 'warn' ? colors.warning : tone === 'bad' ? colors.dangerInk : colors.muted;
  return (
    <View style={styles.chip} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.chipLabel}>{label}</Text>
      <View style={styles.chipValueRow}>
        <View style={[styles.chipDot, { backgroundColor: color }]} />
        <Text style={styles.chipValue} numberOfLines={2}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function SectionHead({ title, hint }: { title: string; hint: string }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.sectionHint}>{hint}</Text>
    </View>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <View style={styles.legend}>
      {items.map((i) => (
        <View key={i.label} style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: i.color }]} />
          <Text style={styles.legendText}>{i.label}</Text>
        </View>
      ))}
    </View>
  );
}

function EmptyPlot({ text }: { text: string }) {
  return (
    <View style={styles.emptyPlot}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

// Start a flow-based breath (a preset by name, or any Vt + bpm) or stop. Only offered on twin firmware:
// 0.7 doesn't know mode "flow" and would run it as a duty breath at the last-used peak.
function FlowControls({
  enabled,
  online,
  running,
  firmware,
  sendCommand,
}: {
  enabled: boolean;
  online: boolean;
  running: boolean;
  firmware: string | null;
  sendCommand: (c: 'start' | 'stop', p: StartParams | Record<string, never>) => Promise<unknown>;
}) {
  const initial = TWIN_PRESETS.find((p) => p.key === DEFAULT_PRESET_KEY) ?? TWIN_PRESETS[0];
  const [vt, setVt] = useState(initial.vt);
  const [bpm, setBpm] = useState(initial.bpm);
  const [busy, setBusy] = useState<'start' | 'stop' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qPeak = peakFlow(vt, bpm);
  const status = peakStatus(qPeak);
  const preset = TWIN_PRESETS.find((p) => Math.abs(p.vt - vt) < 1e-6 && p.bpm === bpm)?.key;

  const send = async (c: 'start' | 'stop') => {
    setError(null);
    let params: StartParams | Record<string, never> = {};
    if (c === 'start') {
      // A preset goes by name (its rate can be fractional); anything else as Vt + whole bpm.
      const start: StartParams = preset
        ? { mode: 'flow', preset }
        : { mode: 'flow', vt: Math.round(vt * 1000) / 1000, bpm: Math.round(bpm), ie_ratio: 1 };
      const invalid = validateStart(start);
      if (invalid) return setError(invalid);
      params = start;
    }
    setBusy(c);
    try {
      await sendCommand(c, params);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.colTitle}>Flow breath</Text>
      {!enabled && (
        <Text style={styles.warnText}>
          Needs twin firmware. The device reports {firmware ?? 'unknown firmware'}, which would run a flow start as a duty
          breath, so starting is turned off here.
        </Text>
      )}
      <View style={styles.presets}>
        {TWIN_PRESETS.map((p) => {
          const st = peakStatus(peakFlow(p.vt, p.bpm));
          const on = p.key === preset;
          return (
            <Pressable
              key={p.key}
              onPress={() => {
                setVt(p.vt);
                setBpm(p.bpm);
              }}
              disabled={!enabled}
              accessibilityRole="button"
              accessibilityLabel={`${p.name} preset`}
              accessibilityState={{ selected: on, disabled: !enabled }}
              style={({ pressed }) => [styles.preset, on && styles.presetOn, pressed && styles.presetPressed, !enabled && styles.dim]}
            >
              <Text style={[styles.presetName, on && styles.presetNameOn]}>{p.name}</Text>
              <Text style={[styles.presetMeta, on && styles.presetNameOn]}>
                {p.vt} L · {p.bpm}/min
              </Text>
              <Text style={[styles.presetMeta, on && styles.presetNameOn]}>
                peak {formatNumber(peakFlow(p.vt, p.bpm), 0)} L/min{st === 'ok' ? '' : ` · ${PEAK_STATUS_LABEL[st]}`}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.sliderHead}>
        <Text style={styles.valueLabel}>Tidal volume</Text>
        <Text style={styles.sliderValue}>{formatNumber(vt, 2)} L</Text>
      </View>
      <Slider
        value={vt}
        min={VT_RANGE.min}
        max={VT_RANGE.max}
        step={VT_RANGE.step}
        onChange={setVt}
        accessibilityLabel="Tidal volume"
        disabled={!enabled}
      />
      <View style={styles.sliderHead}>
        <Text style={styles.valueLabel}>Breathing rate</Text>
        <Text style={styles.sliderValue}>{Number.isInteger(bpm) ? bpm : bpm.toFixed(1)} /min</Text>
      </View>
      <Slider
        value={bpm}
        min={BPM_RANGE.min}
        max={BPM_RANGE.max}
        step={1}
        onChange={(v) => setBpm(Math.round(v))}
        accessibilityLabel="Breathing rate"
        disabled={!enabled}
      />

      <View style={styles.peakRow}>
        <Text style={styles.valueLabel}>Peak flow (π × Vt × bpm)</Text>
        <Text style={styles.peakValue}>{formatNumber(qPeak, 0)} L/min</Text>
      </View>
      {status !== 'ok' && <Text style={styles.warnText}>{flowCheck(vt, bpm).message} Starting is still allowed.</Text>}

      <View style={styles.buttons}>
        <PrimaryButton
          label="Start"
          onPress={() => send('start')}
          disabled={!enabled || !online || running}
          loading={busy === 'start'}
          style={styles.button}
        />
        <PrimaryButton
          label="Stop"
          variant="danger"
          onPress={() => send('stop')}
          disabled={!online || !running}
          loading={busy === 'stop'}
          style={styles.button}
        />
      </View>
      {!online && <Text style={styles.sectionHint}>The device is offline.</Text>}
      {online && running && enabled && <Text style={styles.sectionHint}>Stop the current run to start a new breath.</Text>}
      {error && <Text style={styles.badText}>{error}</Text>}
    </View>
  );
}

// The rig as a flow diagram: inhale fan and exhale fan meet at the flap, one hose runs to the
// headform. The active branch is drawn in its phase colour with chevrons moving along it (into
// the headform on inhale, out of it on exhale) at a speed that follows the twin flow; the flap
// closes the idle branch, and only the active fan spins, at a speed that follows measured rpm.
type Direction = 'inhale' | 'exhale' | null;

const VIEW_W = 320;
const VIEW_H = 184;
const FAN_IN = { x: 40, y: 46 };
const FAN_EX = { x: 40, y: 138 };
const FAN_R = 28;
const PIVOT = { x: 150, y: 92 };
const MASK_X = 238;
const HEAD = { x: 276, y: 92 };
const PIPE = 16;
const CHEVRON_GAP = 22;

type Pt = { x: number; y: number };
// Each branch in the direction air moves through it.
const INHALE_PATH: Pt[] = [{ x: FAN_IN.x + FAN_R, y: FAN_IN.y }, { x: PIVOT.x, y: FAN_IN.y }, PIVOT, { x: MASK_X, y: PIVOT.y }];
const EXHALE_PATH: Pt[] = [{ x: MASK_X, y: PIVOT.y }, PIVOT, { x: PIVOT.x, y: FAN_EX.y }, { x: FAN_EX.x + FAN_R, y: FAN_EX.y }];

// Positions and headings of chevrons spaced along a polyline, shifted by `offset` px.
function chevronsAlong(path: Pt[], offset: number) {
  const out: { x: number; y: number; deg: number }[] = [];
  let carried = offset % CHEVRON_GAP;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    let d = carried;
    for (; d < len - 4; d += CHEVRON_GAP) {
      if (d < 4) continue; // keep clear of corners
      out.push({ x: a.x + ((b.x - a.x) * d) / len, y: a.y + ((b.y - a.y) * d) / len, deg });
    }
    carried = d - len;
  }
  return out;
}

const dirOf = (phase: string | null): Direction =>
  phase === 'exhale' ? 'exhale' : phase === 'inhale' || (phase !== null && phase.startsWith('free')) ? 'inhale' : null;

function RigSchematic({ rpm, duty, phase, qTwin }: { rpm: number; duty: number; phase: string | null; qTwin: number | null }) {
  const reduce = useReduceMotion();
  const dir = dirOf(phase);
  const moving = !!dir && duty > 0;
  const now = useFrameClock(30, !reduce && (moving || rpm > 0));
  // Fan angle and chevron offset are accumulated, so speed changes don't make them jump.
  const anim = useRef({ last: now, fan: 0, flow: 0 }).current;
  const dt = Math.min(0.1, Math.max(0, now - anim.last));
  anim.last = now;
  if (!reduce) {
    anim.fan = (anim.fan + dt * 540 * Math.min(1, rpm / MAX_RPM)) % 360; // ≤ 1.5 turns/s
    const flowFrac = Math.min(1, qTwin != null ? qTwin / Q_MAX_IN : duty / 100);
    if (moving) anim.flow += dt * (8 + 52 * flowFrac); // px/s along the pipe
  }

  const tone = dir === 'exhale' ? colors.seriesA : colors.accent;
  const activeIn = dir === 'inhale';
  const activeEx = dir === 'exhale';
  // Flap blade from the pivot: down closes the exhale branch (inhale), up closes the inhale branch.
  const flapDeg = activeEx ? -90 : 90;
  const chevrons = moving ? chevronsAlong(activeEx ? EXHALE_PATH : INHALE_PATH, anim.flow) : [];

  const pipe = (on: boolean) => ({ fill: colors.background, stroke: on ? tone : colors.inputBorder, strokeWidth: on ? 2 : 1.5 });
  const labelProps = { fill: colors.muted, fontSize: fs(11), fontFamily: font.regular.fontFamily, textAnchor: 'middle' as const };

  return (
    <View
      style={styles.schematic}
      accessible
      accessibilityLabel={`Rig: ${dir ?? 'idle'}, blower ${formatNumber(rpm, 0)} rpm, ${formatNumber(duty, 0)} % duty`}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
        {/* Branches, junction and hose (drawn as filled pipes) */}
        <Rect x={FAN_IN.x} y={FAN_IN.y - PIPE / 2} width={PIVOT.x + PIPE / 2 - FAN_IN.x} height={PIPE} rx={PIPE / 2} {...pipe(activeIn)} />
        <Rect x={FAN_EX.x} y={FAN_EX.y - PIPE / 2} width={PIVOT.x + PIPE / 2 - FAN_EX.x} height={PIPE} rx={PIPE / 2} {...pipe(activeEx)} />
        {/* Junction in two halves, so only the open side is outlined */}
        <Rect x={PIVOT.x - PIPE / 2} y={FAN_IN.y - PIPE / 2} width={PIPE} height={PIVOT.y - FAN_IN.y + PIPE} rx={PIPE / 2} {...pipe(activeIn)} />
        <Rect x={PIVOT.x - PIPE / 2} y={PIVOT.y - PIPE / 2} width={PIPE} height={FAN_EX.y - PIVOT.y + PIPE} rx={PIPE / 2} {...pipe(activeEx)} />
        <Rect x={PIVOT.x} y={PIVOT.y - PIPE / 2} width={MASK_X - PIVOT.x + 4} height={PIPE} rx={PIPE / 2} {...pipe(!!dir)} />

        {chevrons.map((c, i) => (
          <Path
            key={i}
            d="M -3 -5 L 3 0 L -3 5"
            transform={`translate(${c.x.toFixed(1)} ${c.y.toFixed(1)}) rotate(${c.deg})`}
            stroke={tone}
            strokeWidth={2.5}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* Flap */}
        <Line
          x1={PIVOT.x}
          y1={PIVOT.y}
          x2={PIVOT.x + 22 * Math.cos((flapDeg * Math.PI) / 180)}
          y2={PIVOT.y + 22 * Math.sin((flapDeg * Math.PI) / 180)}
          stroke={dir ? colors.strong : colors.muted}
          strokeWidth={4}
          strokeLinecap="round"
        />
        <Circle cx={PIVOT.x} cy={PIVOT.y} r={4} fill={colors.strong} />
        <SvgText x={PIVOT.x + 20} y={FAN_IN.y - 14} {...labelProps}>
          Flap
        </SvgText>

        {/* Fans: only the active one turns */}
        {[
          { c: FAN_IN, on: activeIn, label: 'Inhale fan', ly: FAN_IN.y - FAN_R - 6 },
          { c: FAN_EX, on: activeEx, label: 'Exhale fan', ly: FAN_EX.y + FAN_R + 14 },
        ].map((f) => (
          <G key={f.label}>
            <Circle cx={f.c.x} cy={f.c.y} r={FAN_R} fill={colors.background} stroke={f.on ? tone : colors.inputBorder} strokeWidth={f.on ? 2 : 1.5} />
            <G transform={`translate(${f.c.x} ${f.c.y}) rotate(${f.on ? anim.fan.toFixed(1) : 0}) scale(0.78)`} opacity={f.on ? 1 : 0.45}>
              {[0, 120, 240].map((a) => (
                <Path key={a} d="M 0 0 C 6 -10 6 -24 0 -28 C -6 -24 -6 -10 0 0 Z" fill={colors.strong} transform={`rotate(${a})`} />
              ))}
              <Circle r={5} fill={colors.background} stroke={colors.strong} strokeWidth={1.5} />
            </G>
            <SvgText x={f.c.x} y={f.ly} {...labelProps} fill={f.on ? tone : colors.muted}>
              {f.label}
            </SvgText>
          </G>
        ))}

        {/* Headform with mask; outlined in the phase colour while air moves */}
        <Ellipse cx={HEAD.x} cy={HEAD.y - 6} rx={34} ry={46} fill={colors.background} stroke={moving ? tone : colors.inputBorder} strokeWidth={1.5} />
        <Circle cx={HEAD.x - 10} cy={HEAD.y - 22} r={3} fill={colors.muted} />
        <Circle cx={HEAD.x + 12} cy={HEAD.y - 22} r={3} fill={colors.muted} />
        <Rect x={MASK_X} y={PIVOT.y - 13} width={30} height={26} rx={10} fill={colors.card} stroke={colors.strong} strokeWidth={1.5} />
        <SvgText x={HEAD.x} y={VIEW_H - 2} {...labelProps}>
          Headform
        </SvgText>
      </Svg>
    </View>
  );
}

// Direction and twin flow in words, under the drawing.
function FlowReadout({ fresh, phase, duty, qTwin }: { fresh: boolean; phase: string | null; duty: number | null; qTwin: number | null }) {
  const dir = dirOf(phase);
  if (!fresh) return <Text style={styles.caption}>No live data from the device</Text>;
  if (!dir) return <Text style={styles.caption}>Idle · fans off</Text>;
  const tone = dir === 'exhale' ? colors.seriesA : colors.accent;
  const off = (duty ?? 0) <= 0;
  return (
    <View style={styles.readout} accessible accessibilityLabel={`${dir}, ${off ? 'fans off' : `${formatNumber(qTwin ?? 0, 0)} litres per minute`}`}>
      <View style={styles.readoutPhase}>
        <View style={[styles.chipDot, { backgroundColor: tone }]} />
        <Text style={[styles.readoutLabel, { color: tone }]}>
          {dir === 'inhale' ? 'Inhale · into the headform' : 'Exhale · out of the headform'}
        </Text>
      </View>
      <Text style={styles.readoutValue}>
        {off ? 'fans off' : qTwin != null ? `${formatNumber(qTwin, 0)} L/min` : `${formatNumber(duty ?? 0, 0)} % duty`}
      </Text>
    </View>
  );
}

function Value({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <View style={styles.value} accessible accessibilityLabel={`${label} ${value}`}>
      <Text style={styles.valueLabel}>{label}</Text>
      <Text style={[styles.valueText, muted && styles.valueMuted]}>{value}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingLeft: 40, paddingRight: 24, marginTop: 8 },
  titleText: { flexShrink: 1, fontSize: 30, letterSpacing: -0.8 }, // one line beside the Aa button
  status: { marginHorizontal: 40, marginTop: 4 },
  sub: { ...font.regular, fontSize: fs(14), color: colors.muted, marginHorizontal: 40, marginTop: 4 },
  card: { marginHorizontal: 24, marginTop: 24, padding: 16, borderRadius: 24, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
  schematic: { aspectRatio: VIEW_W / VIEW_H },
  readout: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.cardBorder, alignItems: 'center', gap: 4 },
  readoutPhase: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  readoutLabel: { ...font.bold, fontSize: fs(14) },
  readoutValue: { ...font.monoBold, fontSize: fs(22), letterSpacing: -0.5, color: colors.strong },
  caption: { ...font.mono, fontSize: fs(13), color: colors.muted, marginTop: 8, textAlign: 'center' },
  columns: { flexDirection: 'row', gap: 12, marginHorizontal: 24, marginTop: 16 },
  column: { flex: 1, padding: 16, borderRadius: 24, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
  colTitle: { ...font.bold, fontSize: fs(14), color: colors.muted, marginBottom: 8 },
  value: { paddingVertical: 8 },
  valueLabel: { ...font.regular, fontSize: fs(13), color: colors.muted },
  valueText: { ...font.monoBold, fontSize: fs(17), letterSpacing: -0.4, color: colors.strong, marginTop: 4 },
  valueMuted: { ...font.bold, fontSize: fs(14), letterSpacing: 0, color: colors.muted },
  note: { ...font.regular, fontSize: fs(13), lineHeight: fs(18), color: colors.muted, marginHorizontal: 40, marginTop: 8 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginHorizontal: 24, marginTop: 20 },
  chip: {
    flexGrow: 1,
    flexBasis: 90,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  chipLabel: { ...font.regular, fontSize: fs(12), color: colors.muted },
  chipValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipValue: { ...font.bold, fontSize: fs(15), color: colors.strong, flexShrink: 1 },
  warnText: { ...font.regular, width: '100%', fontSize: fs(13), lineHeight: fs(18), color: colors.warning, marginTop: 8 },
  badNote: { ...font.bold, fontSize: fs(13), lineHeight: fs(18), color: colors.dangerInk, marginHorizontal: 40, marginTop: 8 },
  source: { ...font.regular, fontSize: fs(13), lineHeight: fs(19), color: colors.muted, marginHorizontal: 40, marginTop: 8 },
  hintText: { ...font.regular, width: '100%', fontSize: fs(13), lineHeight: fs(18), color: colors.muted, marginTop: 8 },
  badText: { ...font.bold, width: '100%', fontSize: fs(13), lineHeight: fs(18), color: colors.dangerInk, marginTop: 8 },
  sectionHead: { marginHorizontal: 40, marginTop: 28 },
  sectionTitle: { ...font.bold, fontSize: fs(18), color: colors.strong },
  sectionHint: { ...font.regular, fontSize: fs(13), lineHeight: fs(18), color: colors.muted, marginTop: 4 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginHorizontal: 40, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 16, height: 4, borderRadius: 2 },
  legendText: { ...font.regular, fontSize: fs(13), color: colors.text },
  graph: { marginHorizontal: 24, marginTop: 10 },
  emptyPlot: {
    marginHorizontal: 24,
    marginTop: 10,
    minHeight: 120,
    borderRadius: 30,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  emptyText: { ...font.regular, fontSize: fs(13), lineHeight: fs(18), color: colors.muted, textAlign: 'center' },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4, marginBottom: 8 },
  preset: {
    flexGrow: 1,
    flexBasis: 140,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  presetOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  presetPressed: { opacity: 0.8 },
  dim: { opacity: 0.5 },
  presetName: { ...font.bold, fontSize: fs(13), color: colors.strong },
  presetNameOn: { color: colors.onAccent },
  presetMeta: { ...font.mono, fontSize: fs(11), color: colors.muted, marginTop: 4 },
  sliderHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 12, marginBottom: 4 },
  sliderValue: { ...font.monoBold, fontSize: fs(15), color: colors.strong },
  peakRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  peakValue: { ...font.monoBold, fontSize: fs(20), color: colors.accentText },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 16 },
  button: { flex: 1 },
}));
