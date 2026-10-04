export function summarize(values: number[]) {
  if (!values.length) return { min: 0, avg: 0, max: 0 };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, avg: sum / values.length, max };
}

// Bucket-average a series down to at most `maxPoints` so long runs still draw quickly.
export function downsample(t: number[], v: number[], maxPoints: number) {
  if (v.length <= maxPoints) return { t, v };
  const size = v.length / maxPoints;
  const outT: number[] = [];
  const outV: number[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const from = Math.floor(i * size);
    const to = Math.max(from + 1, Math.floor((i + 1) * size));
    let st = 0;
    let sv = 0;
    for (let j = from; j < to; j++) {
      st += t[j];
      sv += v[j];
    }
    outT.push(st / (to - from));
    outV.push(sv / (to - from));
  }
  return { t: outT, v: outV };
}

// Centred moving average for display only; stats and CSV always use the raw samples.
export function smooth(v: number[], radius: number): number[] {
  if (radius < 1) return v;
  return v.map((_, i) => {
    const from = Math.max(0, i - radius);
    const to = Math.min(v.length - 1, i + radius);
    let sum = 0;
    for (let j = from; j <= to; j++) sum += v[j];
    return sum / (to - from + 1);
  });
}

export function graphSeries(t: number[], v: number[], maxPoints = 160) {
  const d = downsample(t, v, maxPoints);
  return { t: d.t, v: smooth(d.v, 2) };
}
