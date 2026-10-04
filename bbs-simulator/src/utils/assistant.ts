import { Sample, SessionMeta } from '../types';
import { formatDuration, formatNumber, formatRatio, formatRunMeta } from './format';
import { summarize } from './stats';

// Rule-based run assistant: matches keywords in the question and answers only from the
// saved runs' own samples. It never guesses; with no data, it says so.

type Field = Exclude<keyof Sample, 't'>;

interface Metric {
  field: Field;
  name: string;
  unit: string;
  decimals: number;
  match: RegExp;
}

const METRICS: Metric[] = [
  { field: 'tidalVolume', name: 'tidal volume', unit: 'mL', decimals: 0, match: /\b(tidal|volume|vt)\b/ },
  { field: 'pressure', name: 'peak pressure', unit: 'cmH2O', decimals: 1, match: /\b(pressure|cmh2o)\b/ },
  { field: 'temperature', name: 'temperature', unit: '°C', decimals: 1, match: /\b(temp\w*|hot\w*|warm\w*|cold\w*|cool\w*)\b/ },
  { field: 'co2', name: 'CO2', unit: '%', decimals: 1, match: /\b(co2|carbon)\b/ },
  { field: 'humidity', name: 'humidity', unit: '% RH', decimals: 0, match: /\b(humid\w*|moisture)\b/ },
  { field: 'inhaleFan', name: 'inhale fan', unit: 'RPM', decimals: 0, match: /\binhale\b/ },
  { field: 'exhaleFan', name: 'exhale fan', unit: 'RPM', decimals: 0, match: /\bexhale\b/ },
];
const FANS = /\bfans?\b/;

export interface AssistantData {
  runs: SessionMeta[];
  samples: Record<string, Sample[]>;
  // The run the assistant was opened from, if any ("this run").
  focusId?: string;
}

// Non-breaking space so a value never wraps away from its unit.
const fmt = (v: number, m: Metric) => `${formatNumber(v, m.decimals)} ${m.unit}`;
const newestFirst = (runs: SessionMeta[]) => [...runs].sort((a, b) => b.startedAt - a.startedAt);
const label = (r: SessionMeta) => `"${r.name}" (${formatRunMeta(r.startedAt, r.durationSec)})`;

function metricsIn(t: string): Metric[] {
  const found = METRICS.filter((m) => m.match.test(t));
  if (FANS.test(t) && !found.some((m) => m.field === 'inhaleFan' || m.field === 'exhaleFan')) {
    found.push(...METRICS.filter((m) => m.field === 'inhaleFan' || m.field === 'exhaleFan'));
  }
  return found;
}

// Runs named in the question, longest name first so "Adult 2" beats "Adult".
// Where several runs share a name, the newest one is meant.
function namedRuns(t: string, runs: SessionMeta[]): SessionMeta[] {
  const byName = new Map<string, SessionMeta>();
  for (const r of newestFirst(runs)) {
    const key = r.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, r);
  }
  const hits: { at: number; run: SessionMeta }[] = [];
  let rest = t;
  for (const [name, run] of [...byName].sort((a, b) => b[0].length - a[0].length)) {
    const at = rest.indexOf(name);
    if (name && at !== -1) {
      hits.push({ at, run });
      rest = rest.slice(0, at) + ' '.repeat(name.length) + rest.slice(at + name.length);
    }
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.run);
}

// Which single run the question is about.
function targetRun(t: string, d: AssistantData): SessionMeta {
  const sorted = newestFirst(d.runs);
  const named = namedRuns(t, d.runs);
  if (named.length) return named[0];
  if (/\b(first|oldest|earliest)\b/.test(t)) return sorted[sorted.length - 1];
  if (/\b(last|latest|newest|recent|previous)\b/.test(t)) return sorted[0];
  return d.runs.find((r) => r.id === d.focusId) ?? sorted[0];
}

function stats(d: AssistantData, run: SessionMeta, m: Metric) {
  const rows = d.samples[run.id] ?? [];
  return rows.length ? summarize(rows.map((s) => s[m.field])) : null;
}

function summary(d: AssistantData, run: SessionMeta): string {
  const sim = run.simulator;
  const lines = [
    `${label(run)} ran the ${sim.name} simulator (${sim.tidalVolume} mL, ${sim.respiratoryRate} bpm, I:E ${formatRatio(sim.ieRatio)}).`,
  ];
  const parts = METRICS.map((m) => {
    const s = stats(d, run, m);
    return s && `${m.name} ${fmt(s.avg, m)}`;
  }).filter(Boolean);
  lines.push(parts.length ? `Averages: ${parts.join(', ')}.` : 'It has no readings saved.');
  const check = volumeCheck(d, run);
  if (check) lines.push(check);
  return lines.join('\n');
}

// The one thing a run can be checked against: the tidal volume it was set to deliver.
function volumeCheck(d: AssistantData, run: SessionMeta): string | null {
  const m = METRICS[0];
  const s = stats(d, run, m);
  if (!s) return null;
  const target = run.simulator.tidalVolume;
  const off = ((s.avg - target) / target) * 100;
  if (Math.abs(off) < 5) return `Tidal volume stayed on target (set ${target} mL, averaged ${fmt(s.avg, m)}).`;
  return `Tidal volume averaged ${fmt(s.avg, m)}, ${Math.abs(off).toFixed(0)}% ${off > 0 ? 'above' : 'below'} the ${target} mL it was set to.`;
}

// Biggest movers between the first and last quarter of the run.
function unusual(d: AssistantData, run: SessionMeta): string {
  const rows = d.samples[run.id] ?? [];
  if (rows.length < 8) {
    const check = volumeCheck(d, run);
    return `${label(run)} is too short to spot trends (${rows.length} readings). Record a longer run and ask again.${check ? '\n' + check : ''}`;
  }
  const q = Math.floor(rows.length / 4);
  const drifts = METRICS.map((m) => {
    const a = summarize(rows.slice(0, q).map((s) => s[m.field])).avg;
    const b = summarize(rows.slice(-q).map((s) => s[m.field])).avg;
    return { m, a, b, pct: a ? ((b - a) / Math.abs(a)) * 100 : 0 };
  }).filter((x) => Math.abs(x.pct) >= 5);
  const lines = [`Checked ${label(run)}.`];
  const check = volumeCheck(d, run);
  if (check) lines.push(check);
  lines.push(
    drifts.length
      ? 'Drift from start to end: ' +
          drifts.map((x) => `${x.m.name} ${x.pct > 0 ? 'rose' : 'fell'} ${Math.abs(x.pct).toFixed(0)}% (${fmt(x.a, x.m)} → ${fmt(x.b, x.m)})`).join('; ') +
          '.'
      : 'Every sensor held steady, within 5% from start to end.'
  );
  return lines.join('\n');
}

function compare(d: AssistantData, a: SessionMeta, b: SessionMeta, metrics: Metric[]): string {
  const lines = [`${label(a)} vs ${label(b)}:`];
  for (const m of metrics.length ? metrics : METRICS) {
    const sa = stats(d, a, m);
    const sb = stats(d, b, m);
    if (!sa || !sb) continue;
    const diff = sa.avg - sb.avg;
    const delta = formatNumber(Math.abs(diff), m.decimals);
    const change = Number(delta.replace(/,/g, '')) === 0 ? 'same' : `${diff > 0 ? '+' : '−'}${delta}`;
    lines.push(`• ${m.name}: ${fmt(sa.avg, m)} vs ${fmt(sb.avg, m)} (${change})`);
  }
  if (lines.length === 1) lines.push('One of these runs has no readings saved.');
  return lines.join('\n');
}

function rank(d: AssistantData, m: Metric, high: boolean): string {
  const scored = d.runs
    .map((r) => ({ r, s: stats(d, r, m) }))
    .filter((x): x is { r: SessionMeta; s: NonNullable<ReturnType<typeof stats>> } => !!x.s);
  if (!scored.length) return 'None of your runs has readings saved yet.';
  const best = scored.reduce((a, b) => ((high ? b.s.max > a.s.max : b.s.min < a.s.min) ? b : a));
  const value = high ? best.s.max : best.s.min;
  return `${label(best.r)} had the ${high ? 'highest' : 'lowest'} ${m.name}: ${fmt(value, m)} (its average was ${fmt(best.s.avg, m)}). Checked ${scored.length} ${scored.length === 1 ? 'run' : 'runs'}.`;
}

// Distinctive words the matchers above look for: misspellings are corrected to these.
// 4+ letters only; shorter words are too easy to mis-correct.
const VOCAB = [
  'summarise', 'summarize', 'summary', 'overview', 'compare', 'comparison', 'difference', 'versus',
  'highest', 'maximum', 'hottest', 'warmest', 'biggest', 'largest',
  'lowest', 'minimum', 'coolest', 'coldest', 'smallest',
  'tidal', 'volume', 'pressure', 'temperature', 'carbon', 'humidity', 'moisture', 'inhale', 'exhale',
  'unusual', 'problem', 'problems', 'anomaly', 'stable', 'steady', 'normal',
  'which', 'first', 'oldest', 'across', 'session', 'sessions', 'earliest', 'latest', 'newest', 'recent', 'previous',
];
// Everyday words that sit one letter away from a keyword; never "corrected".
const COMMON = [
  'what', 'that', 'this', 'with', 'from', 'have', 'were', 'does', 'your', 'mine', 'show', 'list',
  'last', 'least', 'most', 'must', 'peak', 'temp', 'fans', 'runs', 'help', 'many', 'much', 'tell',
  'about', 'issue', 'issues', 'drift', 'weird', 'wrong', 'okay',
  'time', 'rate', 'give', 'each', 'were', 'recap', 'there', 'their', 'compared',
];

// Optimal string alignment distance: edits, with a swap of neighbours counting as one.
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// "temprature" -> "temperature": one slip allowed, two in words of 7+ letters.
// Run names are left alone so they still match.
function correctTypos(t: string, runs: SessionMeta[]): string {
  const known = new Set([...VOCAB, ...COMMON]);
  runs.forEach((r) => r.name.toLowerCase().split(/[^a-z0-9]+/).forEach((w) => known.add(w)));
  return t.replace(/[a-z]+/g, (word) => {
    if (word.length < 4 || known.has(word)) return word;
    const limit = word.length >= 7 ? 2 : 1;
    let best = word;
    let bestDist = limit + 1;
    for (const v of VOCAB) {
      if (Math.abs(v.length - word.length) > limit) continue;
      const dist = distance(word, v);
      if (dist < bestDist) {
        best = v;
        bestDist = dist;
      }
    }
    return best;
  });
}

export const HELP =
  'I answer from your saved runs. Try:\n• "Summarise my last run"\n• "Compare my last two runs"\n• "Which run had the highest CO2?"\n• "Temperature in my first run"\n• "Anything unusual?"';

export function reply(question: string, d: AssistantData): string {
  const t = correctTypos(question.toLowerCase().trim(), d.runs);
  if (!t) return HELP;
  if (/\b(help|what can you|how do (i|you))\b/.test(t)) return HELP;
  if (/^(hi|hello|hey|thanks|thank you)\b/.test(t)) return `Hi! ${HELP}`;
  if (!d.runs.length) return 'No runs are saved yet. Start a simulator on the Home tab, tap Stop when done, and ask me again.';

  if (/\b(list|show)\b.*\b(runs|sessions)\b/.test(t)) {
    const sorted = newestFirst(d.runs);
    const shown = sorted.slice(0, 10).map((r) => `• ${label(r)}`);
    const more = sorted.length > 10 ? `\n…and ${sorted.length - 10} older.` : '';
    return `Your runs, newest first:\n${shown.join('\n')}${more}`;
  }

  if (/\bhow many\b/.test(t)) {
    const total = formatDuration(d.runs.reduce((sum, r) => sum + r.durationSec, 0));
    return `You have ${d.runs.length} saved ${d.runs.length === 1 ? 'run' : 'runs'}, ${total} of recording in total.`;
  }

  const metrics = metricsIn(t);

  if (/\b(compare|comparison|differen\w*|vs|versus)\b/.test(t)) {
    const named = namedRuns(t, d.runs);
    const sorted = newestFirst(d.runs);
    if (sorted.length < 2) return 'Comparing needs at least two saved runs, and you have one.';
    const focus = d.runs.find((r) => r.id === d.focusId);
    const pair =
      named.length >= 2 ? named.slice(0, 2)
      : named.length === 1 ? [named[0], sorted.find((r) => r.id !== named[0].id)!]
      : focus && !/\b(last|latest|recent)\b/.test(t) ? [focus, sorted.find((r) => r.id !== focus.id)!]
      : sorted.slice(0, 2);
    return compare(d, pair[0], pair[1], metrics);
  }

  const high = /\b(highest|max|maximum|peak|most|hottest|warmest|biggest|largest)\b/.test(t);
  const low = /\b(lowest|min|minimum|least|coolest|coldest|smallest)\b/.test(t);
  const acrossRuns = /\b(which|what) (run|session)\b|\bacross\b|\ball (my )?runs\b|\bany run\b/.test(t);
  if ((high || low) && acrossRuns) {
    if (!metrics.length) return 'Which reading should I rank by? For example: "Which run had the highest CO2?"';
    return metrics.map((m) => rank(d, m, high)).join('\n');
  }

  const run = targetRun(t, d);

  if (/\b(unusual|odd|weird|wrong|problem\w*|issue\w*|anomal\w*|drift\w*|stable|steady|ok|okay|normal)\b/.test(t)) return unusual(d, run);

  if (metrics.length) {
    return metrics
      .map((m) => {
        const s = stats(d, run, m);
        if (!s) return `${label(run)} has no ${m.name} readings.`;
        if (high) return `Highest ${m.name} in ${label(run)}: ${fmt(s.max, m)}.`;
        if (low) return `Lowest ${m.name} in ${label(run)}: ${fmt(s.min, m)}.`;
        return `${m.name[0].toUpperCase() + m.name.slice(1)} in ${label(run)}: min ${fmt(s.min, m)}, avg ${fmt(s.avg, m)}, max ${fmt(s.max, m)}.`;
      })
      .join('\n');
  }

  if (/\b(summar\w*|overview|recap|tell me|how did|how was|about|run|session|this)\b/.test(t)) return summary(d, run);

  return `I didn't catch that. ${HELP}`;
}
