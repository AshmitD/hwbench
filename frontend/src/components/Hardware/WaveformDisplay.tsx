import { useEffect, useRef, useState, useCallback } from 'react';
import { ChannelData } from '../../store/appStore';
import { computeFFT, fmtFreqLabel } from '../../utils/fft';

// ─── Constants ────────────────────────────────────────────────────────────────
const GRID_COLS = 10;
const GRID_ROWS = 8;
const SUBDIVISIONS = 5;
// Warm dark scope — always the same regardless of UI theme
function scopeColors() {
  return {
    bg: '#1a1814',
    gridMinor: 'rgba(255,255,255,0.03)',
    gridMajor: 'rgba(255,255,255,0.07)',
    crosshair: 'rgba(255,255,255,0.10)',
    tick: 'rgba(255,255,255,0.14)',
    label: 'rgba(255,255,255,0.42)',
    frozen: 'rgba(217,119,6,0.8)',
    minimapBg: '#1a1814',
  };
}
const CH1_COLOR = '#0891b2';  // --ch1
const CH2_COLOR = '#d97706';  // --ch2
const MATH_COLOR = '#7c3aed';
const TRIG_COLOR = '#d97706'; // amber trigger line
const CURSOR_A_COLOR = '#86efac';
const CURSOR_B_COLOR = '#fca5a5';
const SAMPLE_RATE_HZ = 200_000; // 1000 samples / 5ms

const MAX_PERSIST_FRAMES = 6;
const PERSIST_ALPHAS = [0.30, 0.22, 0.15, 0.10, 0.06, 0.03];

export interface WaveformProps {
  ch1: ChannelData | null;
  ch2: ChannelData | null;
  paused: boolean;
  // Feature flags from store
  persistMode: boolean;
  fftMode: boolean;
  showCursors: boolean;
  showMath: boolean;
  mathOperation: string;
  // Channel settings
  ch1Enabled: boolean;
  ch2Enabled: boolean;
  ch1Coupling: 'DC' | 'AC' | 'GND';
  ch2Coupling: 'DC' | 'AC' | 'GND';
  ch1Probe: '1x' | '10x' | '100x';
  ch2Probe: '1x' | '10x' | '100x';
  ch1Invert: boolean;
  ch2Invert: boolean;
  ch1VoltPerDiv: number;
  ch2VoltPerDiv: number;
  // Trigger
  triggerLevel: number;
  triggerSource: 'CH1' | 'CH2';
  onTriggerLevelChange: (v: number) => void;
  // Acquisition
  acqMode: 'NORM' | 'PEAK' | 'AVG';
  acqAvgN: number;
  // Derived ch2 override (funcGen)
  ch2Override: number[] | null;
  // Actual time window from scope server (ms). Defaults to 5 for mock frames.
  timeSpanMs?: number;
  // Zoom/pan callbacks
  onTimeDivChange?: (msPerDiv: number) => void;
}

// ─── Pure drawing helpers ─────────────────────────────────────────────────────
function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const c = scopeColors();
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, w, h);
  const cw = w / GRID_COLS, rh = h / GRID_ROWS;

  ctx.strokeStyle = c.gridMinor;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= GRID_COLS * SUBDIVISIONS; i++) {
    const x = Math.round(i / (GRID_COLS * SUBDIVISIONS) * w) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let i = 0; i <= GRID_ROWS * SUBDIVISIONS; i++) {
    const y = Math.round(i / (GRID_ROWS * SUBDIVISIONS) * h) + 0.5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  ctx.strokeStyle = c.gridMajor;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= GRID_COLS; i++) {
    const x = Math.round(i * cw) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let i = 0; i <= GRID_ROWS; i++) {
    const y = Math.round(i * rh) + 0.5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  ctx.strokeStyle = c.crosshair;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  const cx = Math.round(w / 2) + 0.5, cy = Math.round(h / 2) + 0.5;
  ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = c.tick;
  ctx.lineWidth = 1;
  for (let i = 0; i <= GRID_COLS; i++) {
    const x = Math.round(i * cw);
    ctx.beginPath(); ctx.moveTo(x, cy - 4); ctx.lineTo(x, cy + 4); ctx.stroke();
  }
  for (let i = 0; i <= GRID_ROWS; i++) {
    const y = Math.round(i * rh);
    ctx.beginPath(); ctx.moveTo(cx - 4, y); ctx.lineTo(cx + 4, y); ctx.stroke();
  }
}

function drawTrace(
  ctx: CanvasRenderingContext2D,
  samples: number[],
  color: string,
  w: number,
  h: number,
  voltPerDiv: number,
  alpha = 1,
  lineWidth = 1.5,
) {
  if (!samples.length) return;
  const pxPerV = h / (GRID_ROWS * voltPerDiv);
  const cy = h / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.shadowColor = color;
  ctx.shadowBlur = alpha > 0.5 ? 3 : 0;
  ctx.beginPath();
  const step = Math.max(1, Math.floor(samples.length / w));
  let first = true;
  for (let i = 0; i < samples.length; i += step) {
    const x = (i / (samples.length - 1)) * w;
    const y = cy - samples[i] * pxPerV;
    first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    first = false;
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawTriggerLine(
  ctx: CanvasRenderingContext2D, level: number, w: number, h: number, voltPerDiv: number,
) {
  const pxPerV = h / (GRID_ROWS * voltPerDiv);
  const y = Math.round(h / 2 - level * pxPerV) + 0.5;
  if (y < 0 || y > h) return;
  ctx.save();
  ctx.strokeStyle = TRIG_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.globalAlpha = 0.75;
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  ctx.setLineDash([]);
  // Triangle handle on right
  ctx.globalAlpha = 1;
  ctx.fillStyle = TRIG_COLOR;
  ctx.beginPath(); ctx.moveTo(w - 2, y); ctx.lineTo(w - 10, y - 5); ctx.lineTo(w - 10, y + 5); ctx.closePath(); ctx.fill();
  // Label
  ctx.font = '9px JetBrains Mono, monospace';
  ctx.fillStyle = TRIG_COLOR;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.fillText(`T ${level >= 0 ? '+' : ''}${level.toFixed(2)}V`, w - 13, y);
  ctx.textAlign = 'left';
  ctx.restore();
}

function drawCursorLines(
  ctx: CanvasRenderingContext2D,
  ax: number | null, bx: number | null,
  ch1Samples: number[], ch1VPD: number,
  w: number, h: number,
  timeSpanMs = 5,
) {
  const drawOne = (x: number, color: string, label: string) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    // Handle at top
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x - 5, 8); ctx.lineTo(x + 5, 8); ctx.closePath(); ctx.fill();
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, 10);
    ctx.restore();
  };

  if (ax !== null) drawOne(ax, CURSOR_A_COLOR, 'A');
  if (bx !== null) drawOne(bx, CURSOR_B_COLOR, 'B');

  // Delta readout
  if (ax !== null && bx !== null && ch1Samples.length) {
    const pxPerV = h / (GRID_ROWS * ch1VPD);
    const toV = (x: number) => {
      const idx = Math.round((x / w) * (ch1Samples.length - 1));
      return ch1Samples[Math.max(0, Math.min(idx, ch1Samples.length - 1))];
    };
    const va = toV(ax), vb = toV(bx);
    const dt = Math.abs((bx - ax) / w) * timeSpanMs; // ms
    const dv = Math.abs(vb - va);
    const freq = dt > 0 ? 1 / (dt / 1000) : 0;

    const readX = Math.min(ax, bx) + Math.abs(bx - ax) / 2;
    const readY = h - 2;

    // Draw the delta line between cursors at V=0 intercept
    const v1Y = h / 2 - va * pxPerV;
    const v2Y = h / 2 - vb * pxPerV;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(ax, v1Y); ctx.lineTo(bx, v2Y); ctx.stroke();
    ctx.restore();

    const box = [`ΔT ${dt.toFixed(3)}ms`, `ΔV ${dv.toFixed(3)}V`, `1/ΔT ${fmtFreqLabel(freq)}Hz`];
    const bw = 112, bh = 48, bx2 = Math.min(Math.max(readX - bw / 2, 4), w - bw - 4);
    ctx.save();
    ctx.fillStyle = 'rgba(3,10,4,0.88)';
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 0.5;
    ctx.fillRect(bx2, readY - bh, bw, bh);
    ctx.strokeRect(bx2, readY - bh, bw, bh);
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    box.forEach((line, i) => ctx.fillText(line, bx2 + 6, readY - bh + 6 + i * 14));
    ctx.restore();
  }
}

function drawHoverReadout(
  ctx: CanvasRenderingContext2D,
  cursorX: number, w: number, h: number,
  ch1Samples: number[], ch2Samples: number[],
  ch1VPD: number, ch2VPD: number,
) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(cursorX, 0); ctx.lineTo(cursorX, h); ctx.stroke();
  ctx.setLineDash([]);

  const readouts: { y: number; text: string; color: string }[] = [];

  const sampleAt = (samples: number[], x: number) => {
    const idx = Math.round((x / w) * (samples.length - 1));
    return samples[Math.max(0, Math.min(idx, samples.length - 1))];
  };

  if (ch1Samples.length) {
    const v = sampleAt(ch1Samples, cursorX);
    const y = h / 2 - v * (h / (GRID_ROWS * ch1VPD));
    ctx.fillStyle = CH1_COLOR; ctx.shadowColor = CH1_COLOR; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(cursorX, y, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    readouts.push({ y, text: `CH1 ${v >= 0 ? '+' : ''}${v.toFixed(3)}V`, color: CH1_COLOR });
  }
  if (ch2Samples.length) {
    const v = sampleAt(ch2Samples, cursorX);
    const y = h / 2 - v * (h / (GRID_ROWS * ch2VPD));
    ctx.fillStyle = CH2_COLOR; ctx.shadowColor = CH2_COLOR; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(cursorX, y, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    readouts.push({ y, text: `CH2 ${v >= 0 ? '+' : ''}${v.toFixed(3)}V`, color: CH2_COLOR });
  }

  if (!readouts.length) { ctx.restore(); return; }
  const lh = 17, pad = 6, bw = 130, bh = readouts.length * lh + pad * 2;
  const bx = cursorX + 14 + bw < w ? cursorX + 14 : cursorX - bw - 14;
  ctx.fillStyle = 'rgba(3,10,4,0.88)'; ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 0.5;
  ctx.fillRect(bx, 10, bw, bh); ctx.strokeRect(bx, 10, bw, bh);
  readouts.forEach(({ text, color }, i) => {
    ctx.fillStyle = color; ctx.textBaseline = 'top';
    ctx.font = '11px JetBrains Mono, monospace';
    ctx.fillText(text, bx + pad, 10 + pad + i * lh);
  });
  ctx.restore();
}

function drawFFTPanel(
  ctx: CanvasRenderingContext2D, samples: number[], color: string,
  x: number, y: number, w: number, h: number,
) {
  ctx.save();
  ctx.fillStyle = '#020602';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 10; i++) {
    const gx = x + i * w / 10;
    ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke();
  }
  for (let i = 0; i <= 4; i++) {
    const gy = y + i * h / 4;
    ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke();
  }
  // Separator
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke();

  const { frequencies, magnitudesDb, harmonics } = computeFFT(samples, SAMPLE_RATE_HZ);
  const dbMin = -80, dbMax = 0;
  const maxFreq = Math.min(frequencies[frequencies.length - 1], 10000); // cap at 10kHz for display

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = color; ctx.shadowBlur = 3;
  ctx.beginPath();
  let first = true;
  for (let i = 0; i < frequencies.length; i++) {
    if (frequencies[i] > maxFreq) break;
    const px = x + (frequencies[i] / maxFreq) * w;
    const py = y + h - ((magnitudesDb[i] - dbMin) / (dbMax - dbMin)) * h;
    first ? ctx.moveTo(px, py) : ctx.lineTo(px, Math.max(y, Math.min(y + h, py)));
    first = false;
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Label harmonics
  ctx.font = '9px JetBrains Mono, monospace';
  ctx.textBaseline = 'bottom';
  harmonics.slice(0, 4).forEach(f => {
    if (f > maxFreq) return;
    const px = x + (f / maxFreq) * w;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.textAlign = 'center';
    ctx.fillText(fmtFreqLabel(f) + 'Hz', px, y + h - 2);
  });

  // Axis labels
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('FFT CH1', x + 4, y + 2);
  ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  ctx.fillText('10kHz', x + w - 2, y + 2);
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText('-80dB', x + 2, y + h - 1);
  ctx.restore();
}

function fmtTime(ms: number): string {
  if (ms === 0) return '0';
  if (Math.abs(ms) < 1) return `${(ms * 1000).toFixed(0)}μs`;
  return `${ms % 1 === 0 ? ms.toFixed(0) : ms.toFixed(1)}ms`;
}

function fmtVolt(v: number): string {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a < 0.001) return `${(v * 1e6).toFixed(0)}μV`;
  if (a < 1) return `${(v * 1000).toFixed(0)}mV`;
  return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(2)}V`;
}

function drawLabels(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  ch1VPD: number, ch2VPD: number, timeDivMs: number, paused: boolean,
  ch1Enabled: boolean, ch2Enabled: boolean,
  timeSpanMs = 5,
) {
  ctx.save();
  ctx.font = '9px JetBrains Mono, monospace';
  const c = scopeColors();

  // ── Y-axis voltage ticks (left edge) ──────────────────────────────────────
  // Use ch1 V/div for the Y axis labels
  const vpd = ch1VPD;
  const rowH = h / GRID_ROWS;
  ctx.textAlign = 'left';
  for (let row = 0; row <= GRID_ROWS; row++) {
    const volts = (GRID_ROWS / 2 - row) * vpd;
    const y = row * rowH;
    const label = fmtVolt(volts);
    const alpha = volts === 0 ? 0.55 : 0.35;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.textBaseline = volts === 0 ? 'middle' : row === 0 ? 'top' : row === GRID_ROWS ? 'bottom' : 'middle';
    ctx.fillText(label, 3, y);
  }

  // ── X-axis time ticks (bottom row) ────────────────────────────────────────
  const colW = w / GRID_COLS;
  ctx.textBaseline = 'bottom';
  for (let col = 0; col <= GRID_COLS; col++) {
    const ms = (col / GRID_COLS) * timeSpanMs;
    const x = col * colW;
    const label = fmtTime(ms);
    const alpha = col === 0 ? 0.35 : 0.3;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.textAlign = col === 0 ? 'left' : col === GRID_COLS ? 'right' : 'center';
    ctx.fillText(label, x, h - 2);
  }

  // ── Channel / scale badges (top-left) ─────────────────────────────────────
  ctx.textBaseline = 'top';
  if (ch1Enabled) {
    ctx.fillStyle = CH1_COLOR;       ctx.textAlign = 'left'; ctx.fillText('CH1', 6, 6);
    ctx.fillStyle = 'rgba(34,211,238,0.55)';
    ctx.fillText(`${ch1VPD < 1 ? (ch1VPD * 1000).toFixed(0) + 'mV' : ch1VPD + 'V'}/div`, 30, 6);
  }
  if (ch2Enabled) {
    ctx.fillStyle = CH2_COLOR;       ctx.fillText('CH2', 6, 19);
    ctx.fillStyle = 'rgba(245,158,11,0.55)';
    ctx.fillText(`${ch2VPD < 1 ? (ch2VPD * 1000).toFixed(0) + 'mV' : ch2VPD + 'V'}/div`, 30, 19);
  }

  // ── Time/div readout (top-right) ──────────────────────────────────────────
  ctx.fillStyle = c.label;
  ctx.textBaseline = 'top'; ctx.textAlign = 'right';
  const tdLabel = timeDivMs < 1
    ? `${(timeDivMs * 1000).toFixed(0)}μs/div`
    : `${timeDivMs}ms/div`;
  ctx.fillText(tdLabel, w - 4, 6);

  if (paused) {
    ctx.fillStyle = c.frozen;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('FROZEN', w / 2, h - 14);
  }

  ctx.textAlign = 'left';
  ctx.restore();
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function WaveformDisplay({
  ch1, ch2, paused,
  persistMode, fftMode, showCursors, showMath, mathOperation,
  ch1Enabled, ch2Enabled, ch1Coupling, ch2Coupling, ch1Probe, ch2Probe,
  ch1Invert, ch2Invert, ch1VoltPerDiv, ch2VoltPerDiv,
  triggerLevel, triggerSource, onTriggerLevelChange,
  acqMode, acqAvgN, ch2Override, onTimeDivChange,
  timeSpanMs = 5,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dprRef = useRef(window.devicePixelRatio || 1);

  // Frozen frame for pause
  const frozenCh1 = useRef<number[]>([]);
  const frozenCh2 = useRef<number[]>([]);

  // Persistence
  const frameHistory = useRef<{ ch1: number[]; ch2: number[] }[]>([]);

  // Averaging
  const avgBuf = useRef<{ ch1: number[][]; ch2: number[][] }>({ ch1: [], ch2: [] });

  // Zoom / pan
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPan, setViewPan] = useState(0); // 0-1

  // Hover
  const [hoverX, setHoverX] = useState<number | null>(null);

  // Cursors
  const [cursorAx, setCursorAx] = useState<number | null>(null);
  const [cursorBx, setCursorBx] = useState<number | null>(null);

  // Current effective time/div — uses actual timeSpanMs from scope server
  const getTimeDivMs = () => {
    const rawMs = timeSpanMs / (GRID_COLS * viewZoom);
    const stdVals = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5];
    return stdVals.reduce((prev, cur) => Math.abs(cur - rawMs) < Math.abs(prev - rawMs) ? cur : prev);
  };

  // Drag state
  const dragRef = useRef<{
    type: 'cursorA' | 'cursorB' | 'trigger' | 'pan';
    startX: number;
    startVal: number;
  } | null>(null);

  // Process raw samples: coupling, probe, invert, acq mode
  function processAndGetSamples(raw: number[], coupling: 'DC' | 'AC' | 'GND', invert: boolean, probe: '1x' | '10x' | '100x'): number[] {
    if (coupling === 'GND') return new Array(raw.length).fill(0);
    const probeDiv = probe === '100x' ? 100 : probe === '10x' ? 10 : 1;
    let out = raw.map(s => s / probeDiv);
    if (coupling === 'AC') {
      const mean = out.reduce((a, b) => a + b, 0) / out.length;
      out = out.map(s => s - mean);
    }
    if (invert) out = out.map(s => -s);
    return out;
  }

  function applyAcq(samples: number[], buf: number[][], mode: string, avgN: number): number[] {
    if (mode === 'AVG') {
      buf.push(samples);
      if (buf.length > avgN) buf.shift();
      const n = samples.length;
      const result = new Array(n).fill(0);
      for (const f of buf) for (let i = 0; i < n; i++) result[i] += f[i];
      return result.map(v => v / buf.length);
    }
    if (mode === 'PEAK') {
      // Add slight peak-detect noise for visual demonstration
      return samples.map(s => s + (Math.random() - 0.5) * Math.abs(s) * 0.08);
    }
    return samples;
  }

  function getViewSamples(samples: number[]): number[] {
    if (viewZoom <= 1) return samples;
    const n = samples.length;
    const viewN = Math.max(2, Math.round(n / viewZoom));
    const maxStart = n - viewN;
    const startIdx = Math.round(viewPan * maxStart);
    return samples.slice(startIdx, startIdx + viewN);
  }

  function getMathSamples(c1: number[], c2: number[], op: string): number[] {
    const n = Math.min(c1.length, c2.length);
    if (op === 'CH1+CH2') return Array.from({ length: n }, (_, i) => c1[i] + c2[i]);
    if (op === 'CH1-CH2') return Array.from({ length: n }, (_, i) => c1[i] - c2[i]);
    if (op === 'CH1×CH2') return Array.from({ length: n }, (_, i) => c1[i] * c2[i]);
    return [];
  }

  // ── Main draw ──────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = dprRef.current;
    const W = canvas.width / dpr, H = canvas.height / dpr;
    if (W === 0 || H === 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const mainH = fftMode ? H * 0.62 : H;
    const fftH = fftMode ? H * 0.38 : 0;

    // Build display samples
    const raw1 = frozenCh1.current;
    const raw2 = ch2Override !== null ? ch2Override : frozenCh2.current;

    const processed1 = ch1Enabled ? processAndGetSamples(raw1, ch1Coupling, ch1Invert, ch1Probe) : [];
    const processed2 = ch2Enabled ? processAndGetSamples(raw2, ch2Coupling, ch2Invert, ch2Probe) : [];

    const view1 = getViewSamples(processed1);
    const view2 = getViewSamples(processed2);

    drawGrid(ctx, W, mainH);

    // Persistence ghost traces
    if (persistMode) {
      frameHistory.current.forEach((frame, i) => {
        const alpha = PERSIST_ALPHAS[i] ?? 0.03;
        if (ch1Enabled && frame.ch1.length) drawTrace(ctx, getViewSamples(frame.ch1), CH1_COLOR, W, mainH, ch1VoltPerDiv, alpha, 1);
        if (ch2Enabled && frame.ch2.length) drawTrace(ctx, getViewSamples(frame.ch2), CH2_COLOR, W, mainH, ch2VoltPerDiv, alpha, 1);
      });
    }

    // Math channel
    if (showMath && view1.length && view2.length) {
      const math = getMathSamples(view1, view2, mathOperation);
      const mvpd = Math.max(ch1VoltPerDiv, ch2VoltPerDiv);
      drawTrace(ctx, math, MATH_COLOR, W, mainH, mvpd);
    }

    // Main traces
    if (ch1Enabled && view1.length) drawTrace(ctx, view1, CH1_COLOR, W, mainH, ch1VoltPerDiv);
    if (ch2Enabled && view2.length) drawTrace(ctx, view2, CH2_COLOR, W, mainH, ch2VoltPerDiv);

    // Trigger line
    const trigVPD = triggerSource === 'CH1' ? ch1VoltPerDiv : ch2VoltPerDiv;
    drawTriggerLine(ctx, triggerLevel, W, mainH, trigVPD);

    // Cursors
    if (showCursors) drawCursorLines(ctx, cursorAx, cursorBx, view1, ch1VoltPerDiv, W, mainH, timeSpanMs / viewZoom);

    // Hover cursor (paused only)
    if (paused && hoverX !== null) drawHoverReadout(ctx, hoverX, W, mainH, view1, view2, ch1VoltPerDiv, ch2VoltPerDiv);

    // Axis labels
    drawLabels(ctx, W, mainH, ch1VoltPerDiv, ch2VoltPerDiv, getTimeDivMs(), paused, ch1Enabled, ch2Enabled, timeSpanMs / viewZoom);

    // FFT panel
    if (fftMode && view1.length) {
      drawFFTPanel(ctx, view1, CH1_COLOR, 0, mainH, W, fftH);
    }

    // ── Minimap ──────────────────────────────────────────────────────────────
    const mmap = minimapRef.current;
    if (mmap) {
      const mctx = mmap.getContext('2d');
      if (mctx && raw1.length) {
        const mW = mmap.width / dpr, mH = mmap.height / dpr;
        mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        mctx.fillStyle = scopeColors().minimapBg;
        mctx.fillRect(0, 0, mW, mH);
        // Draw tiny full trace
        if (ch1Enabled) {
          mctx.strokeStyle = 'rgba(34,211,238,0.4)'; mctx.lineWidth = 0.8;
          const vr = ch1VoltPerDiv * GRID_ROWS;
          mctx.beginPath();
          raw1.forEach((s, i) => {
            const mx = (i / (raw1.length - 1)) * mW;
            const my = mH / 2 - (s / vr) * mH;
            i === 0 ? mctx.moveTo(mx, my) : mctx.lineTo(mx, my);
          });
          mctx.stroke();
        }
        // Window rectangle
        const winX = viewPan * (1 - 1 / viewZoom) * mW;
        const winW = mW / viewZoom;
        mctx.fillStyle = 'rgba(34,211,238,0.07)';
        mctx.fillRect(winX, 0, winW, mH);
        mctx.strokeStyle = 'rgba(34,211,238,0.4)';
        mctx.lineWidth = 1;
        mctx.strokeRect(winX, 0, winW, mH);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ch1, ch2, paused, hoverX, cursorAx, cursorBx, viewZoom, viewPan,
    persistMode, fftMode, showCursors, showMath, mathOperation,
    ch1Enabled, ch2Enabled, ch1Coupling, ch2Coupling, ch1Probe, ch2Probe,
    ch1Invert, ch2Invert, ch1VoltPerDiv, ch2VoltPerDiv,
    triggerLevel, triggerSource, acqMode, acqAvgN, ch2Override,
  ]);

  // Update frozen refs + persistence + avg buffer
  useEffect(() => {
    if (!ch1) return;
    const raw1 = ch1.samples;
    const raw2 = (ch2Override !== null ? ch2Override : ch2?.samples) ?? [];

    if (!paused) {
      frozenCh1.current = raw1;
      frozenCh2.current = ch2Override ?? ch2?.samples ?? [];

      // AVG buffer
      avgBuf.current.ch1.push(raw1);
      if (avgBuf.current.ch1.length > acqAvgN) avgBuf.current.ch1.shift();
      if (raw2.length) {
        avgBuf.current.ch2.push(raw2);
        if (avgBuf.current.ch2.length > acqAvgN) avgBuf.current.ch2.shift();
      }

      if (acqMode === 'AVG') {
        frozenCh1.current = applyAcq(raw1, avgBuf.current.ch1, 'AVG', acqAvgN);
        frozenCh2.current = raw2.length ? applyAcq(raw2, avgBuf.current.ch2, 'AVG', acqAvgN) : [];
      } else if (acqMode === 'PEAK') {
        // Each frame gets random spikes added — visible as spikier trace
        frozenCh1.current = applyAcq(raw1, avgBuf.current.ch1, 'PEAK', acqAvgN);
        frozenCh2.current = raw2.length ? applyAcq(raw2, avgBuf.current.ch2, 'PEAK', acqAvgN) : [];
      }

      // Persistence: add slight variation so ghosts have spread
      if (persistMode) {
        const noise = (s: number) => s + (Math.random() - 0.5) * 0.025;
        frameHistory.current.push({
          ch1: raw1.map(noise),
          ch2: raw2.map(noise),
        });
        if (frameHistory.current.length > MAX_PERSIST_FRAMES) frameHistory.current.shift();
      } else {
        frameHistory.current = [];
      }
    }
    draw();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch1, ch2, ch2Override, paused, acqMode, acqAvgN, persistMode]);

  useEffect(() => { draw(); }, [draw]);

  // Canvas resize
  const resize = useCallback(() => {
    const canvas = canvasRef.current, container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    const { width, height } = container.getBoundingClientRect();
    const setCanvas = (c: HTMLCanvasElement, h: number) => {
      c.width = Math.round(width * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${width}px`;
      c.style.height = `${h}px`;
    };
    setCanvas(canvas, height);
    if (minimapRef.current) {
      const mmap = minimapRef.current;
      mmap.width = Math.round(width * dpr);
      mmap.height = Math.round(40 * dpr);
      mmap.style.width = `${width}px`;
      mmap.style.height = `40px`;
    }
  }, []);

  useEffect(() => {
    resize();
    const obs = new ResizeObserver(resize);
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [resize]);

  // ── Mouse handlers ─────────────────────────────────────────────────────────
  const getCanvasX = (e: React.MouseEvent | MouseEvent): number => {
    const rect = containerRef.current!.getBoundingClientRect();
    return e.clientX - rect.left;
  };

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const x = getCanvasX(e);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const h = canvas.height / dprRef.current;
    const trigVPD = triggerSource === 'CH1' ? ch1VoltPerDiv : ch2VoltPerDiv;
    const trigY = h / 2 - triggerLevel * (h / (GRID_ROWS * trigVPD));

    let type: 'cursorA' | 'cursorB' | 'trigger' | 'pan' = 'pan';
    if (showCursors && cursorAx !== null && Math.abs(x - cursorAx) < 9) type = 'cursorA';
    else if (showCursors && cursorBx !== null && Math.abs(x - cursorBx) < 9) type = 'cursorB';
    else if (Math.abs(e.clientY - containerRef.current!.getBoundingClientRect().top - trigY) < 8) type = 'trigger';

    dragRef.current = { type, startX: x, startVal: type === 'trigger' ? triggerLevel : type === 'cursorA' ? (cursorAx ?? x) : (cursorBx ?? x) };
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current || !containerRef.current) return;
      const x = e.clientX - containerRef.current.getBoundingClientRect().left;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const W = canvas.width / dprRef.current, H = canvas.height / dprRef.current;
      const mainH = fftMode ? H * 0.62 : H;
      const { type, startX, startVal } = dragRef.current;

      if (type === 'cursorA') {
        setCursorAx(Math.max(0, Math.min(W, x)));
      } else if (type === 'cursorB') {
        setCursorBx(Math.max(0, Math.min(W, x)));
      } else if (type === 'trigger') {
        const trigVPD = triggerSource === 'CH1' ? ch1VoltPerDiv : ch2VoltPerDiv;
        const pxPerV = mainH / (GRID_ROWS * trigVPD);
        const dy = (e.clientY - containerRef.current.getBoundingClientRect().top) - (mainH / 2 - startVal * pxPerV);
        const newLevel = startVal - dy / pxPerV;
        onTriggerLevelChange(Math.max(-trigVPD * GRID_ROWS / 2, Math.min(trigVPD * GRID_ROWS / 2, newLevel)));
        dragRef.current = { ...dragRef.current, startVal: newLevel };
      } else if (type === 'pan' && viewZoom > 1) {
        const dx = x - startX;
        const panDelta = -(dx / W) / (1 - 1 / viewZoom);
        setViewPan(p => Math.max(0, Math.min(1, p + panDelta)));
        dragRef.current = { ...dragRef.current, startX: x };
      }
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [viewZoom, triggerSource, ch1VoltPerDiv, ch2VoltPerDiv, onTriggerLevelChange, fftMode]);

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width / dprRef.current;
    const mouseXFrac = getCanvasX(e as unknown as React.MouseEvent) / W;

    const factor = e.deltaY > 0 ? 0.78 : 1.28;
    setViewZoom(z => {
      const nz = Math.max(1, Math.min(100, z * factor));
      // Keep mouseX anchored
      const oldViewSize = 1 / z, newViewSize = 1 / nz;
      const anchorFrac = viewPan * (1 - oldViewSize) + mouseXFrac * oldViewSize;
      const newStart = anchorFrac - mouseXFrac * newViewSize;
      setViewPan(Math.max(0, Math.min(1, nz <= 1 ? 0 : newStart / (1 - newViewSize))));
      onTimeDivChange?.(Math.max(0.001, Math.min(5, 5 / (10 * nz))));
      return nz;
    });
  };

  const onDblClick = () => { setViewZoom(1); setViewPan(0); };

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    const H = (canvas?.height ?? 0) / dprRef.current;
    const mainH = fftMode ? H * 0.62 : H;
    const y = e.clientY - (containerRef.current?.getBoundingClientRect().top ?? 0);
    if (y > mainH) { setHoverX(null); return; } // in FFT area — no readout
    if (!paused) { setHoverX(null); return; }
    setHoverX(getCanvasX(e));
  };
  const onMouseLeave = () => setHoverX(null);

  // Cursor initialisation click (when cursors enabled, shift+click places them)
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!showCursors || !e.shiftKey) return;
    const x = getCanvasX(e);
    if (cursorAx === null || (cursorBx !== null)) { setCursorAx(x); setCursorBx(null); }
    else setCursorBx(x);
  };

  // Minimap click to pan
  const onMinimapClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const mmap = minimapRef.current;
    if (!mmap || viewZoom <= 1) return;
    const rect = mmap.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    setViewPan(Math.max(0, Math.min(1, (frac - 0.5 / viewZoom) / (1 - 1 / viewZoom))));
  };

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', overflow: 'hidden', background: 'var(--scope-bg)', cursor: paused ? 'crosshair' : viewZoom > 1 ? 'grab' : 'default', userSelect: 'none' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onWheel={onWheel}
      onDoubleClick={onDblClick}
      onClick={onClick}
    >
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%' }} />
      <canvas
        ref={minimapRef}
        style={{ display: 'block', width: '100%', height: '40px', flexShrink: 0, cursor: 'pointer' }}
        onClick={onMinimapClick}
      />
    </div>
  );
}
