import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { fs, colors, font, themedStyles } from '../theme';
import { Sample, SensorKey } from '../types';
import { sensorByKey } from '../constants/sensors';
import { graphSeries, summarize } from '../utils/stats';
import { formatAxis, formatNumber } from '../utils/format';
import { LineGraph } from './waves';

// Functions, not constants: `colors` changes with the theme.
const seriesColors = () => [colors.strong, colors.seriesA];

// Graph (or table) + min/avg/max block for one recorded run, frames 07/07b.
export function SensorPanel({
  samples,
  sensor,
  view,
  duration,
}: {
  samples: Sample[];
  sensor: SensorKey;
  view: 'graph' | 'table';
  duration: number;
}) {
  const def = sensorByKey(sensor);
  const t = samples.map((s) => s.t);

  if (!samples.length) {
    return <Text style={styles.noData}>No readings were recorded for this run.</Text>;
  }

  return (
    <View>
      {view === 'graph' ? (
        <>
          <LineGraph
            height={206}
            duration={duration}
            unit={def.unit}
            series={def.series.map((s, i) => ({
              ...graphSeries(t, samples.map((x) => x[s.field])),
              color: seriesColors()[i],
            }))}
          />
          {def.series.length > 1 && (
            <View style={styles.legend}>
              {def.series.map((s, i) => (
                <View key={s.field} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: seriesColors()[i] }]} />
                  <Text style={styles.axisText}>{s.statLabel.replace(' RPM', '')}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      ) : (
        <SensorTable samples={samples} sensor={sensor} />
      )}

      <View style={[styles.stats, def.series.length > 1 && styles.statsTight]}>
        {def.series.map((s) => {
          const sum = summarize(samples.map((x) => x[s.field]));
          return (
            <View key={s.field} style={styles.statRow}>
              {(['min', 'avg', 'max'] as const).map((k) => (
                <View key={k} style={styles.stat} accessible accessibilityLabel={`${k} ${s.statLabel} ${formatNumber(sum[k], def.decimals)}`}>
                  <Text style={styles.statValue}>{formatNumber(sum[k], def.decimals)}</Text>
                  <Text style={styles.statLabel}>
                    {k} {s.statLabel}
                  </Text>
                </View>
              ))}
            </View>
          );
        })}
      </View>
    </View>
  );
}

// Table view has no Figma frame; it reuses the graph card's shape so the toggle
// swaps content without the layout jumping.
function SensorTable({ samples, sensor }: { samples: Sample[]; sensor: SensorKey }) {
  const def = sensorByKey(sensor);
  const every = Math.max(1, Math.ceil(samples.length / 120));
  const rows = samples.filter((_, i) => i % every === 0);
  return (
    <View style={styles.table}>
      <View style={[styles.tr, styles.th]}>
        <Text style={[styles.cell, styles.head]}>Time</Text>
        {def.series.map((s) => (
          <Text key={s.field} style={[styles.cell, styles.head, styles.num]}>
            {def.series.length > 1 ? s.statLabel.replace(' RPM', '') : def.unit}
          </Text>
        ))}
      </View>
      {/* No scroll indicator: on web it overlays the right-aligned value column. */}
      <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        {rows.map((r) => (
          <View key={r.t} style={styles.tr}>
            <Text style={styles.cell}>{formatAxis(r.t)}</Text>
            {def.series.map((s) => (
              <Text key={s.field} style={[styles.cell, styles.num]}>
                {formatNumber(r[s.field], def.decimals)}
              </Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = themedStyles(() => ({
  noData: { ...font.regular, fontSize: fs(14), color: colors.muted, marginTop: 20 },
  axisText: { ...font.regular, fontSize: fs(14), color: colors.muted },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  legendDot: { width: 7, height: 7, borderRadius: 3.5 },
  stats: { marginTop: 34, gap: 18 },
  statsTight: { marginTop: 14 },
  // Three equal columns (115pt each in the 393pt frame) that narrow on smaller phones.
  statRow: { flexDirection: 'row', paddingLeft: 16 },
  stat: { flex: 1, maxWidth: 115 },
  statValue: { ...font.regular, fontSize: fs(20), color: colors.text },
  statLabel: { ...font.regular, fontSize: fs(13), color: colors.muted, marginTop: 4 },
  table: {
    height: 238,
    borderRadius: 30,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 22,
    paddingVertical: 12,
    overflow: 'hidden',
  },
  tr: { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.cardBorder },
  th: { borderBottomColor: colors.inputBorder },
  cell: { ...font.regular, flex: 1, fontSize: fs(14), color: colors.text, fontVariant: ['tabular-nums'] },
  head: { ...font.bold, color: colors.muted },
  num: { textAlign: 'right' },
}));
