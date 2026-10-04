import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { CSV_COLUMNS } from '../constants/sensors';
import { Sample, SessionMeta } from '../types';

function escape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildCsv(runs: { meta: SessionMeta; samples: Sample[] }[]): string {
  const multi = runs.length > 1;
  const header = [...(multi ? ['Run'] : []), ...CSV_COLUMNS.map((c) => c.label)];
  const rows = [header.join(',')];
  for (const { meta, samples } of runs) {
    for (const s of samples) {
      const cells = CSV_COLUMNS.map((c) => s[c.field].toFixed(c.decimals));
      rows.push([...(multi ? [escape(meta.name)] : []), ...cells].join(','));
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
