// Cooley-Tukey radix-2 FFT (in-place, on power-of-2 sized arrays)
function fftInPlace(re: Float32Array, im: Float32Array, n: number): void {
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  // Butterfly passes
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j], uIm = im[i + j];
        const vRe = re[i + j + half] * curRe - im[i + j + half] * curIm;
        const vIm = re[i + j + half] * curIm + im[i + j + half] * curRe;
        re[i + j] = uRe + vRe; im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe; im[i + j + half] = uIm - vIm;
        const nr = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nr;
      }
    }
  }
}

export interface FFTResult {
  frequencies: number[];   // Hz
  magnitudesDb: number[];  // dBFS
  peakFreq: number;
  peakDb: number;
  harmonics: number[];     // top harmonic frequencies
}

export function computeFFT(samples: number[], sampleRateHz: number): FFTResult {
  const N = 1024;
  const re = new Float32Array(N);
  const im = new Float32Array(N);

  // Fill with Hanning-windowed samples
  for (let i = 0; i < N; i++) {
    const s = i < samples.length ? samples[i] : 0;
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    re[i] = s * hann;
    im[i] = 0;
  }

  fftInPlace(re, im, N);

  const half = N / 2;
  const frequencies: number[] = [];
  const magnitudesDb: number[] = [];

  for (let i = 1; i < half; i++) {
    const mag = (2 * Math.sqrt(re[i] ** 2 + im[i] ** 2)) / N;
    const db = 20 * Math.log10(Math.max(mag, 1e-9));
    frequencies.push((i * sampleRateHz) / N);
    magnitudesDb.push(db);
  }

  // Find peak (ignore DC at bin 0)
  let peakIdx = 0;
  for (let i = 1; i < magnitudesDb.length; i++) {
    if (magnitudesDb[i] > magnitudesDb[peakIdx]) peakIdx = i;
  }
  const peakFreq = frequencies[peakIdx];
  const peakDb = magnitudesDb[peakIdx];

  // Top harmonics (peaks above -60dB that aren't within 10% of each other)
  const threshold = Math.max(-60, peakDb - 40);
  const harmonics: number[] = [];
  for (let i = 0; i < magnitudesDb.length; i++) {
    if (magnitudesDb[i] > threshold) {
      const f = frequencies[i];
      if (!harmonics.some(h => Math.abs(h - f) / Math.max(f, 1) < 0.1)) {
        harmonics.push(f);
      }
    }
  }
  harmonics.sort((a, b) => a - b);

  return { frequencies, magnitudesDb, peakFreq, peakDb, harmonics: harmonics.slice(0, 5) };
}

export function fmtFreqLabel(hz: number): string {
  if (hz >= 1000) return `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k`;
  return `${hz.toFixed(0)}`;
}
