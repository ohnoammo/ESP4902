import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton, PrimaryButton, Screen, useTopInset } from '../components/basics';
import { SensorChips } from '../components/controls';
import { LineGraph } from '../components/waves';
import { SessionsStackParams } from '../navigation/types';
import { useData } from '../state/DataContext';
import { sensorByKey, seriesValue } from '../constants/sensors';
import { fs, colors, font, themedStyles, type } from '../theme';
import { Sample, SensorKey, SessionMeta } from '../types';
import { graphSeries, summarize } from '../utils/stats';
import { formatNumber } from '../utils/format';
import { buildCsv, csvFileName, exportCsv } from '../utils/csv';

// Line colours in pick order; the first two are the Figma Compare colours.
// A function, not a constant: `colors` changes with the theme.
export const compareColors = () => [colors.seriesA, colors.seriesB, colors.seriesC, colors.seriesD, colors.seriesE];
export const MAX_COMPARE = 5;

export function CompareScreen({ navigation, route }: NativeStackScreenProps<SessionsStackParams, 'Compare'>) {
  const top = useTopInset();
  const insets = useSafeAreaInsets();
  const { sessions, loadSamples } = useData();
  const { ids } = route.params;
  const found = ids.map((id) => sessions.find((s) => s.id === id));
  const [data, setData] = useState<Sample[][] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sensor, setSensor] = useState<SensorKey>('temp');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    Promise.all(ids.map(loadSamples))
      .then(setData)
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [ids, loadSamples]);

  if (found.some((r) => !r)) {
    return (
      <Screen style={{ paddingTop: top + 11 }}>
        <BackButton label="Sessions" onPress={() => navigation.goBack()} />
        <Text style={[type.meta, { margin: 37 }]}>One of these runs was deleted.</Text>
      </Screen>
    );
  }
  const runs = found as SessionMeta[];
  const def = sensorByKey(sensor);
  // Fans compare the inhale fan, the series the design uses for single-line views.
  const series = def.series[0];
  const duration = Math.max(...runs.map((r) => r.durationSec));
  const stats = data?.map((samples) => summarize(samples.map((s) => seriesValue(series, s))));
  const unitLabel = def.key === 'fans' ? 'inhale RPM' : def.unit;
  const fmt = (v: number) => formatNumber(v, def.decimals);
  const signed = (v: number) => `${v >= 0 ? '+' : '−'}${fmt(Math.abs(v))}`;

  const onExport = async () => {
    if (!data) return;
    setExporting(true);
    try {
      await exportCsv(
        csvFileName(runs.length === 2 ? `${runs[0].name}-vs-${runs[1].name}` : `compare-${runs.length}-runs`),
        buildCsv(runs.map((meta, i) => ({ meta, samples: data[i] })))
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: top + 11, paddingBottom: 24 }}>
        <BackButton label="Sessions" onPress={() => navigation.goBack()} />
        <Text style={[type.hero, styles.title]} accessibilityRole="header">
          Compare
        </Text>
        <View style={styles.body}>
          <View style={styles.legend}>
            {runs.map((r, i) => (
              <View key={r.id} style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: compareColors()[i] }]} />
                <Text style={styles.legendText} numberOfLines={1}>
                  {r.name}
                </Text>
              </View>
            ))}
          </View>

          {!data && <Text style={type.meta}>{loadError ? `Couldn't load the readings: ${loadError}` : 'Loading readings…'}</Text>}
          {data && (
            <LineGraph
              height={200}
              duration={duration}
              unit={unitLabel}
              strokeWidth={3.2}
              series={data.map((samples, i) => ({
                ...graphSeries(samples.map((s) => s.t), samples.map((s) => seriesValue(series, s))),
                color: compareColors()[i],
              }))}
            />
          )}
          <View style={styles.chips}>
            <SensorChips value={sensor} onChange={setSensor} />
          </View>

          {stats && runs.length === 2 && (
            // Two runs: the Figma layout, one column per run.
            <View style={styles.table}>
              <PairRow label={`Average ${unitLabel}`} a={fmt(stats[0].avg)} b={fmt(stats[1].avg)} />
              <PairRow label={`Peak ${unitLabel}`} a={fmt(stats[0].max)} b={fmt(stats[1].max)} />
              <View style={[styles.row, { borderBottomWidth: 0 }]}>
                <Text style={styles.rowLabel}>Difference</Text>
                <Text style={[styles.rowValue, { color: colors.accentText }]}>{signed(stats[0].avg - stats[1].avg)}</Text>
              </View>
            </View>
          )}

          {stats && runs.length > 2 && (
            // Three or more runs don't fit as columns, so each run gets a row instead.
            <View style={styles.table}>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>{unitLabel}</Text>
                <Text style={styles.headValue}>Average</Text>
                <Text style={styles.headValue}>Peak</Text>
              </View>
              {runs.map((r, i) => (
                <View key={r.id} style={styles.row}>
                  <View style={styles.runCell}>
                    <View style={[styles.dot, { backgroundColor: compareColors()[i] }]} />
                    <Text style={styles.runName} numberOfLines={1}>
                      {r.name}
                    </Text>
                  </View>
                  <Text style={styles.rowValue}>{fmt(stats[i].avg)}</Text>
                  <Text style={styles.rowValue}>{fmt(stats[i].max)}</Text>
                </View>
              ))}
              <View style={[styles.row, { borderBottomWidth: 0 }]}>
                <Text style={styles.rowLabel}>Spread of averages</Text>
                <Text style={[styles.rowValue, { color: colors.accentText }]}>
                  {fmt(Math.max(...stats.map((s) => s.avg)) - Math.min(...stats.map((s) => s.avg)))}
                </Text>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
      <PrimaryButton
        label={runs.length === 2 ? 'Export both' : `Export all ${runs.length}`}
        height={44}
        onPress={onExport}
        disabled={!data}
        loading={exporting}
        style={{ marginBottom: Math.max(insets.bottom, 20) + 40 }}
      />
    </Screen>
  );
}

function PairRow({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{a}</Text>
      <Text style={styles.rowValue}>{b}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  title: { marginLeft: 37, marginTop: 11 },
  body: { marginHorizontal: 37, marginTop: 14 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8, marginBottom: 23 },
  legendItem: { width: '50%', flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 12 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  legendText: { ...font.regular, fontSize: fs(13), color: colors.muted, flexShrink: 1 },
  chips: { marginTop: 22, marginRight: -24 },
  table: { marginTop: 22 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    borderBottomWidth: 1,
    borderBottomColor: colors.dividerDim,
  },
  rowLabel: { ...font.regular, fontSize: fs(14), color: colors.muted, flex: 1 },
  rowValue: { ...font.regular, fontSize: fs(15), color: colors.text, width: 86, textAlign: 'right' },
  headValue: { ...font.regular, fontSize: fs(13), color: colors.muted, width: 86, textAlign: 'right' },
  runCell: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  runName: { ...font.regular, fontSize: fs(14), color: colors.text, flexShrink: 1 },
}));
