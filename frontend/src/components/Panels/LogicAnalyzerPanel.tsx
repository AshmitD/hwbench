import { useEffect, useRef, useState, useCallback } from 'react';
import { useAppStore } from '../../store/appStore';
import type { LAChannel } from '../../store/appStore';
import styles from './LogicAnalyzerPanel.module.css';

const CH_NAMES = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'];
const CH_COLORS = ['#22d3ee', '#4ade80', '#fb923c', '#c084fc', '#f472b6', '#60a5fa', '#a3e635', '#fbbf24'];
const LANE_H = 44;
const LABEL_W = 52;
const TIME_AXIS_H = 26;

const SAMPLE_RATES = [
  { label: '200kHz', value: 200_000 },
  { label: '500kHz', value: 500_000 },
  { label: '1MHz',   value: 1_000_000 },
  { label: '4MHz',   value: 4_000_000 },
  { label: '8MHz',   value: 8_000_000 },
  { label: '16MHz',  value: 16_000_000 },
  { label: '24MHz',  value: 24_000_000 },
];

function fmtNs(ns: number): string {
  if (ns < 1000) return `${ns.toFixed(0)}ns`;
  if (ns < 1_000_000) return `${(ns / 1000).toFixed(ns < 10_000 ? 1 : 0)}μs`;
  return `${(ns / 1_000_000).toFixed(ns < 10_000_000 ? 1 : 0)}ms`;
}

function fmtSampleRate(hz: number): string {
  if (hz >= 1_000_000) return `${hz / 1_000_000}MHz`;
  return `${hz / 1_000}kHz`;
}

function drawChannel(
  ctx: CanvasRenderingContext2D,
  chan: LAChannel,
  startNs: number,
  endNs: number,
  x0: number,
  w: number,
  yHigh: number,
  yLow: number,
  color: string,
) {
  const span = endNs - startNs;
  if (span <= 0) return;

  // Determine state at startNs by replaying transitions before it
  let val = chan.initial;
  for (const t of chan.transitions) {
    if (t <= startNs) val ^= 1;
    else break;
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = color;
  ctx.shadowBlur = 3;
  ctx.beginPath();

  const toX = (ns: number) => x0 + ((ns - startNs) / span) * w;
  let curY = val === 1 ? yHigh : yLow;
  ctx.moveTo(x0, curY);

  for (const t of chan.transitions) {
    if (t <= startNs) continue;
    if (t >= endNs) break;
    const x = toX(t);
    ctx.lineTo(x, curY);
    val ^= 1;
    curY = val === 1 ? yHigh : yLow;
    ctx.lineTo(x, curY);
  }

  ctx.lineTo(x0 + w, curY);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

export default function LogicAnalyzerPanel() {
  const laFrame    = useAppStore(s => s.laFrame);
  const laError    = useAppStore(s => s.laError);
  const laNames    = useAppStore(s => s.laChannelNames);
  const setLAName  = useAppStore(s => s.setLAChannelName);
  const setLAError = useAppStore(s => s.setLAError);
  const send       = useAppStore(s => s.sendScopeCommand);

  const [sampleRate, setSampleRate] = useState(1_000_000);
  const [enabled, setEnabled] = useState<boolean[]>(CH_NAMES.map(() => true));
  const [running, setRunning] = useState(false);
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPan, setViewPan] = useState(0);
  const [editingCh, setEditingCh] = useState<number | null>(null);
  const [editVal, setEditVal] = useState('');
  const [resizeTick, setResizeTick] = useState(0);

  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const wrapRef    = useRef<HTMLDivElement>(null);
  const dragRef    = useRef<{ startX: number; startPan: number } | null>(null);

  // Sync running state from live LA frame
  useEffect(() => {
    if (laFrame) setRunning(laFrame.la_status === 'running');
  }, [laFrame?.la_status]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRunStop = () => {
    const next = !running;
    setRunning(next);
    send({ device: 'la-1', cmd: next ? 'start' : 'stop' });
  };

  const handleRateChange = (value: number) => {
    setSampleRate(value);
    send({ device: 'la-1', cmd: 'set_sample_rate', value });
  };

  const handleChannelToggle = (idx: number) => {
    const next = enabled.map((v, i) => i === idx ? !v : v);
    setEnabled(next);
    const enabledIdxs = next.map((v, i) => v ? i : -1).filter(i => i >= 0);
    send({ device: 'la-1', cmd: 'set_channels', enabled: enabledIdxs });
  };

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.3 : 1 / 1.3;
    setViewZoom(prev => {
      const next = Math.max(1, Math.min(500, prev * factor));
      // Keep pan in range after zoom change
      if (next === 1) setViewPan(0);
      return next;
    });
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startPan: viewPan };
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragRef.current || !wrapRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const w = wrapRef.current.getBoundingClientRect().width - LABEL_W;
    const panDelta = -(dx / w) / viewZoom;
    setViewPan(Math.max(0, Math.min(1, dragRef.current.startPan + panDelta)));
  }, [viewZoom]);

  const handleMouseUp = () => { dragRef.current = null; };

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    wrap.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      wrap.removeEventListener('wheel', handleWheel);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleWheel, handleMouseMove]);

  // Canvas drawing
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const { width, height } = wrap.getBoundingClientRect();
    if (width < 2 || height < 2) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width  = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const activeChannels = CH_NAMES.map((_, i) => i).filter(i => enabled[i]);
    const numLanes = activeChannels.length;
    const canvasH = numLanes * LANE_H + TIME_AXIS_H;

    // Background
    ctx.fillStyle = '#141210';
    ctx.fillRect(0, 0, width, canvasH);

    if (numLanes === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = `12px var(--font-mono, monospace)`;
      ctx.textAlign = 'center';
      ctx.fillText('All channels disabled', width / 2, canvasH / 2);
      return;
    }

    const waveW = width - LABEL_W;
    const timeSpanNs = laFrame?.config.time_span_ns ?? 1_000_000_000 / sampleRate * 1000;
    const visibleSpan = timeSpanNs / viewZoom;
    const startNs = viewPan * (timeSpanNs - visibleSpan);
    const endNs   = startNs + visibleSpan;

    // Grid lines (10 vertical columns)
    const COLS = 10;
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 0.5;
    for (let c = 1; c < COLS; c++) {
      const x = LABEL_W + (c / COLS) * waveW;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, numLanes * LANE_H);
      ctx.stroke();
    }

    // Lanes + waveforms
    activeChannels.forEach((chIdx, laneIdx) => {
      const chName = CH_NAMES[chIdx];
      const color  = CH_COLORS[chIdx];
      const label  = laNames[chName] ?? chName;
      const yTop   = laneIdx * LANE_H;
      const yMid   = yTop + LANE_H / 2;

      // Lane separator
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, yTop + LANE_H - 0.5);
      ctx.lineTo(width, yTop + LANE_H - 0.5);
      ctx.stroke();

      // Label background
      ctx.fillStyle = '#1a1814';
      ctx.fillRect(0, yTop, LABEL_W, LANE_H);

      // Channel color indicator
      ctx.fillStyle = color;
      ctx.fillRect(0, yTop + 4, 3, LANE_H - 8);

      // Label text
      ctx.fillStyle = color;
      ctx.font = `bold 9px var(--font-mono, monospace)`;
      ctx.textAlign = 'left';
      ctx.fillText(chName, 8, yMid - 5);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = `9px var(--font-mono, monospace)`;
      if (label !== chName) {
        ctx.fillText(label.slice(0, 6), 8, yMid + 6);
      }

      // Waveform
      const yHigh = yTop + 6;
      const yLow  = yTop + LANE_H - 10;

      const chan = laFrame?.channels[chName];
      if (!chan) {
        // No data — draw flat low line
        ctx.strokeStyle = `${color}55`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(LABEL_W, yLow);
        ctx.lineTo(LABEL_W + waveW, yLow);
        ctx.stroke();
      } else {
        ctx.save();
        ctx.beginPath();
        ctx.rect(LABEL_W, yTop, waveW, LANE_H);
        ctx.clip();
        drawChannel(ctx, chan, startNs, endNs, LABEL_W, waveW, yHigh, yLow, color);
        ctx.restore();
      }
    });

    // Overflow banner
    if (laFrame?.overflow) {
      ctx.fillStyle = 'rgba(239,68,68,0.2)';
      ctx.fillRect(LABEL_W, 0, waveW, numLanes * LANE_H);
      ctx.fillStyle = '#ef4444';
      ctx.font = `bold 11px var(--font-sans, sans-serif)`;
      ctx.textAlign = 'center';
      ctx.fillText('⚠ Buffer overflow — reduce sample rate', LABEL_W + waveW / 2, numLanes * LANE_H / 2);
    }

    // Time axis
    const axisY = numLanes * LANE_H;
    ctx.fillStyle = '#1a1814';
    ctx.fillRect(0, axisY, width, TIME_AXIS_H);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(LABEL_W, axisY);
    ctx.lineTo(width, axisY);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = `9px var(--font-mono, monospace)`;
    ctx.textAlign = 'center';
    for (let c = 0; c <= COLS; c++) {
      const t = startNs + (c / COLS) * visibleSpan;
      const x = LABEL_W + (c / COLS) * waveW;
      ctx.fillText(fmtNs(t), x, axisY + 16);
    }

  }, [laFrame, enabled, viewZoom, viewPan, sampleRate, laNames, resizeTick]);

  // Resize observer — triggers redraw when the panel is resized
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const obs = new ResizeObserver(() => setResizeTick(t => t + 1));
    obs.observe(wrap);
    return () => obs.disconnect();
  }, []);

  const laStatus = laFrame?.la_status ?? 'searching';
  const activeCount = CH_NAMES.filter((_, i) => enabled[i]).length;
  const displayRate = laFrame?.config.sample_rate ?? sampleRate;

  const startLabelEdit = (idx: number) => {
    setEditingCh(idx);
    setEditVal(laNames[CH_NAMES[idx]] ?? CH_NAMES[idx]);
  };
  const commitLabelEdit = () => {
    if (editingCh !== null) {
      setLAName(CH_NAMES[editingCh], editVal.trim() || CH_NAMES[editingCh]);
      setEditingCh(null);
    }
  };

  return (
    <div className={styles.panel}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <span className={laStatus === 'running' ? styles.badgeRun : laStatus === 'stopped' ? styles.badgeIdle : styles.badgeSearch}>
          {laStatus === 'running' ? 'RUN' : laStatus === 'stopped' ? 'STOP' : 'SEARCHING'}
        </span>

        <div className={styles.toolbarDivider} />

        <button
          className={`${styles.runBtn} ${running ? styles.runBtnActive : ''}`}
          onClick={handleRunStop}
          title={running ? 'Stop capture' : 'Start capture'}>
          {running ? 'STOP' : 'RUN'}
        </button>

        <div className={styles.toolbarDivider} />

        <span className={styles.label}>Rate</span>
        <select
          className={styles.select}
          value={sampleRate}
          onChange={e => handleRateChange(Number(e.target.value))}>
          {SAMPLE_RATES.map(r => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>

        <div className={styles.toolbarDivider} />

        <span className={styles.label}>Channels</span>
        {CH_NAMES.map((ch, i) => (
          <button
            key={ch}
            className={`${styles.chBtn} ${enabled[i] ? styles.chBtnOn : ''}`}
            style={enabled[i] ? { borderColor: CH_COLORS[i], color: CH_COLORS[i] } : undefined}
            onClick={() => handleChannelToggle(i)}
            title={`Toggle ${ch}`}>
            {i}
          </button>
        ))}

        <div className={styles.spacer} />

        {viewZoom > 1 && (
          <button className={styles.zoomReset} onClick={() => { setViewZoom(1); setViewPan(0); }} title="Reset zoom">
            ×{viewZoom.toFixed(1)} ↺
          </button>
        )}

        <span className={styles.infoLabel}>
          {fmtSampleRate(displayRate)} · {activeCount}CH
        </span>
      </div>

      {laError && (
        <div className={styles.errorBanner}>
          {laError}
          <button onClick={() => setLAError(null)}>✕</button>
        </div>
      )}

      {/* Canvas area */}
      <div
        ref={wrapRef}
        className={styles.canvasWrap}
        onMouseDown={handleMouseDown}
        style={{ cursor: viewZoom > 1 ? 'grab' : 'default' }}>
        {laStatus === 'searching' && !laFrame && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>⎡⎤</div>
            <div>Searching for FX2 logic analyzer...</div>
            <div className={styles.emptyHint}>Connect an FX2-based LA (VID:PID 04b4:8613 or 0925:3881)</div>
          </div>
        )}
        <canvas ref={canvasRef} />
      </div>

      {/* Channel rename drawer (bottom) */}
      <div className={styles.renameBar}>
        {CH_NAMES.map((ch, i) => (
          <div key={ch} className={styles.renameCell}>
            {editingCh === i ? (
              <input
                className={styles.renameInput}
                value={editVal}
                autoFocus
                onChange={e => setEditVal(e.target.value)}
                onBlur={commitLabelEdit}
                onKeyDown={e => { if (e.key === 'Enter') commitLabelEdit(); if (e.key === 'Escape') setEditingCh(null); }}
                maxLength={8}
              />
            ) : (
              <button
                className={styles.renameBtn}
                style={{ color: enabled[i] ? CH_COLORS[i] : 'var(--text-tertiary)' }}
                onClick={() => startLabelEdit(i)}
                title="Double-click to rename">
                {laNames[ch] ?? ch}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
