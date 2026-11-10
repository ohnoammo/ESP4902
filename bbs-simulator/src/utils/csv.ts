import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { CSV_COLUMNS } from '../constants/sensors';
import { Sample, SessionMeta } from '../types';
import { formatSettings, formatTimestampSgt } from './format';
import { ThermalEvent, eventsAt } from '../thermal/events';

function escape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Thermal columns per second: whether the camera was streaming, and any alert active then
// (leak / high / low). Blank camera column = not watching, so no alert doesn't mean no leak.
export function buildCsv(runs: { meta: SessionMeta; samples: Sample[]; events?: ThermalEvent[] }[]): string {
  const multi = runs.length > 1;
  const header = [...(multi ? ['Run'] : []), 'Settings', 'Sampled at (SGT)', ...CSV_COLUMNS.map((c) => c.label), 'Thermal camera', 'Thermal alert'];
  const rows = [header.join(',')];
  for (const { meta, samples, events = [] } of runs) {
    for (const s of samples) {
      const cells = CSV_COLUMNS.map((c) => c.value(s));
      const ms = meta.startedAt + s.t * 1000;
      const thermal = eventsAt(events, ms);
      const at = formatTimestampSgt(ms);
      rows.push(
        [...(multi ? [escape(meta.name)] : []), escape(formatSettings(meta.simulator)), at, ...cells, thermal.watching ? 'watching' : '', thermal.alerts.join(' ')].join(',')
      );
    }
  }
  return rows.join('\n');
}

export function csvFileName(label: string): string {
  const safe = label.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  const stamp = new Date().toISOString().slice(0, 10);
  return `${safe || 'run'}-${stamp}.csv`;
}

// Web: browser download. Native: write to cache and open the share sheet.
export async function exportCsv(fileName: string, csv: string): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(csv);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: fileName });
  }
}
