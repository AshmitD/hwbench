export interface WaveformStats {
  frequency: number;
  period: number;
  vpp: number;
  vmax: number;
  vmin: number;
  vrms: number;
  vmean: number;
  dutyCycle: number;   // % (meaningful for square waves)
  riseTime: number;    // ms (10%-90%)
}

// timeSpanMs: the real duration the sample array covers.
// For mock frames it's 5ms (200kHz × 1000 samples).
// For live scope frames it comes from the server's time_span_ms field.
export function computeStats(
  samples: number[],
  knownFreq?: number,
  timeSpanMs = 5,
): WaveformStats {
  if (!samples || samples.length === 0) {
    return { frequency: 0, period: 0, vpp: 0, vmax: 0, vmin: 0, vrms: 0, vmean: 0, dutyCycle: 50, riseTime: 0 };
  }

  const n = samples.length;
  let vmax = -Infinity, vmin = Infinity, sumSq = 0, sum = 0;
  for (const s of samples) {
    if (s > vmax) vmax = s;
    if (s < vmin) vmin = s;
    sumSq += s * s;
    sum += s;
  }

  const vmean = sum / n;
  const vrms = Math.sqrt(sumSq / n);
  const vpp = vmax - vmin;
  const mid = (vmax + vmin) / 2;

  // Frequency from rising zero-crossings through the midpoint
  let crossings = 0;
  for (let i = 1; i < n; i++) {
    if (samples[i - 1] < mid && samples[i] >= mid) crossings++;
  }
  const frequency = knownFreq ?? (crossings > 0 ? (crossings / (timeSpanMs / 1000)) : 0);
  const period = frequency > 0 ? 1000 / frequency : 0; // ms

  const aboveMid = samples.filter(s => s > mid).length;
  const dutyCycle = (aboveMid / n) * 100;

  // Rise time: find first 10%→90% rising edge
  const lo = vmin + vpp * 0.1;
  const hi = vmin + vpp * 0.9;
  let riseTime = 0;
  for (let i = 1; i < n - 1; i++) {
    if (samples[i - 1] < lo && samples[i] >= lo) {
      for (let j = i; j < n; j++) {
        if (samples[j] >= hi) {
          riseTime = ((j - i) / n) * timeSpanMs;
          break;
        }
      }
      if (riseTime > 0) break;
    }
  }

  return { frequency, period, vpp, vmax, vmin, vrms, vmean, dutyCycle, riseTime };
}

// Apply channel processing: coupling, invert, probe scaling
export function processChannel(
  samples: number[],
  coupling: 'DC' | 'AC' | 'GND',
  invert: boolean,
  probe: '1x' | '10x' | '100x',
): number[] {
  if (coupling === 'GND') return new Array(samples.length).fill(0);

  const probeDiv = probe === '100x' ? 100 : probe === '10x' ? 10 : 1;
  let out = samples.map(s => s / probeDiv);

  if (coupling === 'AC') {
    const mean = out.reduce((a, b) => a + b, 0) / out.length;
    out = out.map(s => s - mean);
  }

  if (invert) out = out.map(s => -s);
  return out;
}

// Average N frames of samples together
export function averageFrames(frames: number[][]): number[] {
  if (!frames.length) return [];
  const n = frames[0].length;
  const result = new Array(n).fill(0);
  for (const f of frames) {
    for (let i = 0; i < n; i++) result[i] += f[i];
  }
  return result.map(v => v / frames.length);
}

// Generate local waveform for function generator preview
export function generateFuncGenSamples(
  waveform: 'sine' | 'square' | 'triangle' | 'sawtooth',
  freqHz: number,
  amplitude: number,
  offset: number,
  sampleCount = 1000,
  windowMs = 5,
): number[] {
  const T = 1000 / freqHz; // period in ms
  return Array.from({ length: sampleCount }, (_, i) => {
    const t = (i / sampleCount) * windowMs; // ms
    const phase = (t % T) / T; // 0-1 within cycle
    const halfAmp = amplitude / 2;
    let v = 0;
    switch (waveform) {
      case 'sine': v = halfAmp * Math.sin(2 * Math.PI * phase); break;
      case 'square': v = phase < 0.5 ? halfAmp : -halfAmp; break;
      case 'triangle': v = halfAmp * (phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase); break;
      case 'sawtooth': v = halfAmp * (2 * phase - 1); break;
    }
    return v + offset;
  });
}

export function fmtStat(v: number, unit: string, decimals = 3): string {
  if (!isFinite(v) || isNaN(v)) return '—';
  const abs = Math.abs(v);
  if (unit === 'Hz') {
    if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}MHz`;
    if (abs >= 1e3) return `${(v / 1e3).toFixed(2)}kHz`;
    return `${v.toFixed(1)}Hz`;
  }
  if (unit === 'V') {
    if (abs < 0.001) return `${(v * 1e6).toFixed(1)}μV`;
    if (abs < 1) return `${(v * 1000).toFixed(1)}mV`;
    return `${v.toFixed(decimals)}V`;
  }
  if (unit === 'ms') {
    if (abs < 0.001) return `${(v * 1e6).toFixed(2)}ns`;
    if (abs < 1) return `${(v * 1000).toFixed(2)}μs`;
    return `${v.toFixed(3)}ms`;
  }
  if (unit === '%') return `${v.toFixed(1)}%`;
  return `${v.toFixed(decimals)}${unit}`;
}
