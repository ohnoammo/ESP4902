import React, { useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';
import { volumeAt } from '../mock/breathing';
import { fs, colors, font, themedStyles } from '../theme';
import { Simulator } from '../types';
import { formatAxis } from '../utils/format';

// Re-renders at ~`fps` while mounted, so waves can derive their shape from wall-clock time.
export function useFrameClock(fps = 30, enabled = true) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      if (now - last >= 1000 / fps) {
        last = now;
        setTick((n) => n + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fps, enabled]);
  return Date.now() / 1000;
}

function useWidth(initial = 393) {
  const [width, setWidth] = useState(initial);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  return { width, onLayout };
}

// Welcome/connecting hero wave: a scrolling sine, optionally "breathing" in amplitude.
// Size, speed and breathing all ease toward their targets and the scroll phase is
// accumulated rather than derived from the clock, so changing any prop mid-animation
// morphs the wave smoothly instead of making it jump.
export function SineWave({
  height,
  amplitude,
  wavelength,
  strokeWidth = 7,
  speed = 60, // px per second
  breathe = false,
}: {
  height: number;
  amplitude: number;
  wavelength: number;
  strokeWidth?: number;
  speed?: number;
  breathe?: boolean;
}) {
  const now = useFrameClock();
  const { width, onLayout } = useWidth();
  const s = useRef({ last: now, amp: amplitude, wl: wavelength, speed, phase: 0, mix: breathe ? 1 : 0, breath: 0 }).current;

  const dt = Math.min(0.1, Math.max(0, now - s.last));
  s.last = now;
  const ease = 1 - Math.exp(-dt * 3.5); // ~0.6 s to settle
  s.amp += (amplitude - s.amp) * ease;
  s.wl += (wavelength - s.wl) * ease;
  s.speed += (speed - s.speed) * ease;
  s.mix += ((breathe ? 1 : 0) - s.mix) * ease;
  s.phase = (s.phase + (dt * s.speed) / s.wl) % 1;
  // The breathing cycle starts at full size (cos 0 = 1), so turning it on never pops.
  if (breathe) s.breath += dt * 1.6;
  else if (s.mix < 0.01) s.breath = 0;

  const breathFactor = 0.5 + 0.5 * Math.cos(s.breath);
  const amp = s.amp * (1 - s.mix + s.mix * breathFactor);
  const mid = height / 2;
  let d = '';
  for (let x = -4; x <= width + 4; x += 4) {
    const y = mid - amp * Math.sin((x / s.wl + s.phase) * Math.PI * 2);
    d += `${d ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return (
    <View style={{ height }} onLayout={onLayout}>
      <Svg width={width} height={height}>
        <Path d={d} stroke={colors.strong} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

// Breathing-pattern wave used on Ready (preview) and Running (live). It is the same
// volume curve the mock device records, drawn over a fixed 8 s window scrolling right-to-left,
// so a faster respiratory rate visibly packs in more breaths. The y-axis is lung volume in mL
// (0 at end of exhale, the tidal volume at end of inhale), so the size of each breath is readable.
export function BreathWave({
  pattern,
  height,
  startedAt,
  live,
  windowSec = 8,
}: {
  pattern: Pick<Simulator, 'respiratoryRate' | 'ieRatio' | 'tidalVolume'>;
  height: number;
  startedAt?: number;
  // Live mode (Running screen): plot the device's streamed volume readings instead of
  // the idealised pattern. Points use seconds since `startedAt`.
  live?: { t: number; v: number }[];
  windowSec?: number;
}) {
  const now = useFrameClock();
  const { width, onLayout } = useWidth();
  const t = startedAt ? now - startedAt / 1000 : now;
  const tv = pattern.tidalVolume;
  const ticks = [tv, tv / 2, 0];
  const labels = ticks.map((v) => String(Math.round(v)));
  const labelRight = 13 + Math.max(...labels.map((l) => l.length), 2) * 7.5;
  const padLeft = labelRight + 10;
  const padTop = 22; // unit label sits above the top tick
  const padBottom = 5;
  const yScale = (v: number) => padTop + (1 - v) * (height - padTop - padBottom);
  const plotW = Math.max(1, width - padLeft);
  let d = '';
  if (live) {
    const from = t - windowSec;
    for (const p of live) {
      if (p.t < from - 0.2) continue;
      const x = padLeft + ((p.t - from) / windowSec) * plotW;
      const v = Math.min(1.1, Math.max(-0.05, p.v / tv)); // keep overshoot on-screen
      d += `${d ? 'L' : 'M'}${x.toFixed(1)} ${yScale(v).toFixed(1)}`;
    }
  } else {
    for (let x = 0; x <= plotW; x += 3) {
      const v = volumeAt(pattern, t - windowSec + (x / plotW) * windowSec);
      d += `${d ? 'L' : 'M'}${(padLeft + x).toFixed(1)} ${yScale(v).toFixed(1)}`;
    }
  }
  const axisText = { fill: colors.muted, fontSize: fs(12), fontFamily: font.regular.fontFamily };
  return (
    <View
      style={{ height }}
      onLayout={onLayout}
      accessible
      accessibilityLabel={`Breathing waveform, 0 to ${tv} millilitres, ${pattern.respiratoryRate} breaths per minute`}
    >
      <Svg width={width} height={height}>
        <SvgText x={labelRight} y={11} textAnchor="end" {...axisText}>
          mL
        </SvgText>
        {ticks.map((v, i) => {
          const y = yScale(v / tv);
          return (
            <React.Fragment key={i}>
              <Line x1={padLeft} x2={width} y1={y} y2={y} stroke={colors.gridLine} strokeWidth={1} strokeDasharray="3 4" />
              <SvgText x={labelRight} y={y + 4} textAnchor="end" {...axisText}>
                {labels[i]}
              </SvgText>
            </React.Fragment>
          );
        })}
        <Path d={d} stroke={colors.strong} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
    </View>
  );
}

// Static thumbnail of a simulator's pattern for the Home cards: the same volume curve and
// 8 s window as BreathWave, sized and stroked like the Figma card icon.
export function MiniBreathWave({
  pattern,
  width = 93.5,
  height = 31.5,
  windowSec = 8,
}: {
  pattern: Pick<Simulator, 'respiratoryRate' | 'ieRatio'>;
  width?: number;
  height?: number;
  windowSec?: number;
}) {
  const pad = 1.75; // half the stroke, so peaks aren't clipped
  let d = '';
  for (let x = 0; x <= width - pad * 2; x += 1) {
    const v = volumeAt(pattern, (x / (width - pad * 2)) * windowSec);
    const y = pad + (1 - v) * (height - pad * 2);
    d += `${d ? 'L' : 'M'}${(pad + x).toFixed(1)} ${y.toFixed(1)}`;
  }
  return (
    <Svg width={width} height={height} pointerEvents="none">
      <Path d={d} stroke={colors.strong} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

export interface GraphSeries {
  t: number[];
  v: number[];
  color: string;
}

// Picks ~3 evenly spaced "round" tick values (steps of 1, 2 or 5 × 10^k) covering the data,
// so the axis reads 33.4 / 33.6 / 33.8 rather than arbitrary min/max values.
function niceTicks(lo: number, hi: number, target = 3) {
  const raw = (hi - lo) / target;
  const base = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * base).find((s) => s >= raw * 0.999) ?? 10 * base;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let i = 0; start + i * step <= end + step / 2; i++) ticks.push(start + i * step);
  return { ticks, decimals: Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) };
}

// Rounded graph card from the Recorded session / Compare frames, with a y-axis so the
// magnitude is readable, not just the shape.
export function LineGraph({
  series,
  duration,
  height,
  unit,
  strokeWidth = 3.5,
}: {
  series: GraphSeries[];
  duration: number;
  height: number;
  unit: string;
  strokeWidth?: number;
}) {
  const { width, onLayout } = useWidth(330);
  const all = series.flatMap((s) => s.v);
  let lo = all.length ? Math.min(...all) : 0;
  let hi = all.length ? Math.max(...all) : 1;
  if (hi - lo < 1e-6) {
    lo -= 1;
    hi += 1;
  }
  const { ticks, decimals } = niceTicks(lo, hi);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const labels = ticks.map((v) =>
    v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  );
  const labelW = Math.max(...labels.map((l) => l.length), unit.length) * 7;

  const padLeft = 16 + labelW + 10;
  const padRight = 23;
  const padTop = 38; // room for the unit label above the top tick
  const padBottom = 40; // room for the time labels under the bottom tick
  const xScale = (t: number) => padLeft + (t / Math.max(duration, 1)) * (width - padLeft - padRight);
  const yScale = (v: number) => height - padBottom - ((v - yMin) / (yMax - yMin)) * (height - padTop - padBottom);

  return (
    <View style={[graphStyles.card, { height }]} onLayout={onLayout}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <SvgText x={16} y={20} fill={colors.muted} fontSize={fs(12)} fontFamily={font.regular.fontFamily}>
          {unit}
        </SvgText>
        <SvgText x={padLeft} y={height - 14} fill={colors.muted} fontSize={fs(12)} fontFamily={font.regular.fontFamily}>
          0:00
        </SvgText>
        <SvgText
          x={width - padRight}
          y={height - 14}
          fill={colors.muted}
          fontSize={fs(12)}
          textAnchor="end"
          fontFamily={font.regular.fontFamily}
        >
          {formatAxis(duration)}
        </SvgText>
        {ticks.map((v, i) => {
          const y = yScale(v);
          return (
            <React.Fragment key={i}>
              <Line
                x1={padLeft}
                x2={width - padRight}
                y1={y}
                y2={y}
                stroke={colors.gridLine}
                strokeWidth={1}
                strokeDasharray="3 4"
              />
              <SvgText
                x={16 + labelW}
                y={y + 4}
                fill={colors.muted}
                fontSize={fs(12)}
                textAnchor="end"
                fontFamily={font.regular.fontFamily}
              >
                {labels[i]}
              </SvgText>
            </React.Fragment>
          );
        })}
        {series.map((s, i) => {
          if (s.v.length === 1) {
            const y = yScale(s.v[0]);
            return (
              <Path key={i} d={`M${padLeft} ${y}L${width - padRight} ${y}`} stroke={s.color} strokeWidth={strokeWidth} strokeLinecap="round" />
            );
          }
          const d = s.v.map((v, j) => `${j ? 'L' : 'M'}${xScale(s.t[j]).toFixed(1)} ${yScale(v).toFixed(1)}`).join('');
          return (
            <Path key={i} d={d} stroke={s.color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          );
        })}
      </Svg>
    </View>
  );
}

const graphStyles = themedStyles(() => ({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 30,
    overflow: 'hidden',
  },
}));
