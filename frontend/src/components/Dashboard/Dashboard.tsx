import { useEffect, useMemo, useRef } from 'react';
import {
  Activity,
  Bot,
  Braces,
  ChevronRight,
  Cpu,
  Gauge,
  GitBranch,
  RadioTower,
  Ruler,
  TerminalSquare,
  Zap,
} from 'lucide-react';
import { TileId, useAppStore } from '../../store/appStore';
import { computeStats, fmtStat } from '../../utils/waveformMath';
import OscilloscopePanel from '../Panels/OscilloscopePanel';
import ProtocolPanel from '../Panels/ProtocolPanel';
import FuncGenPanel from '../Panels/FuncGenPanel';
import CodeContextPanel from '../CodeContext/CodeContextPanel';
import SchematicPanel from '../Schematic/SchematicPanel';
import LogicAnalyzerPanel from '../Panels/LogicAnalyzerPanel';
import TilePicker from './TilePicker';
import WorkbenchTile from './WorkbenchTile';
import styles from './Dashboard.module.css';

const TILE_ORDER: TileId[] = ['osc', 'la', 'proto', 'measurements', 'funcgen', 'schematic', 'ai', 'cad', 'code'];
const WAVE_ICONS: Record<string, string> = { sine: '~', square: 'sq', triangle: 'tri', sawtooth: 'saw' };

function fmtFreq(hz: number): string {
  if (hz >= 1_000_000) return `${(hz / 1_000_000).toFixed(2)} MHz`;
  if (hz >= 1_000) return `${(hz / 1_000).toFixed(2)} kHz`;
  return `${hz.toFixed(0)} Hz`;
}

function ScopePreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const frame = useAppStore(s => s.hardwareFrame);
  const ch1Enabled = useAppStore(s => s.ch1Enabled);
  const ch2Enabled = useAppStore(s => s.ch2Enabled);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = wrap.getBoundingClientRect();
      if (width < 2 || height < 2) return;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = '#1a1814';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(255,255,255,0.055)';
      ctx.lineWidth = 0.5;
      for (let i = 1; i < 10; i++) {
        const x = Math.round(width * i / 10) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let i = 1; i < 8; i++) {
        const y = Math.round(height * i / 8) + 0.5;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }

      const drawTrace = (samples: number[], color: string, range: number) => {
        if (!samples.length) return;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.7;
        ctx.shadowColor = color;
        ctx.shadowBlur = 4;
        ctx.beginPath();
        const step = Math.max(1, Math.floor(samples.length / Math.max(width, 1)));
        let first = true;
        for (let i = 0; i < samples.length; i += step) {
          const x = (i / (samples.length - 1)) * width;
          const y = height / 2 - (samples[i] / range) * (height * 0.42);
          first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          first = false;
        }
        ctx.stroke();
        ctx.restore();
      };

      if (ch1Enabled) drawTrace(frame?.oscilloscope.ch1.samples ?? [], '#0891b2', 3.3);
      if (ch2Enabled) drawTrace(frame?.oscilloscope.ch2?.samples ?? [], '#d97706', 5);
    };

    draw();
    const obs = new ResizeObserver(draw);
    obs.observe(wrap);
    return () => obs.disconnect();
  }, [frame, ch1Enabled, ch2Enabled]);

  return <div ref={wrapRef} className={styles.scopePreview}><canvas ref={canvasRef} /></div>;
}

function StatusPill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'live' | 'warn' }) {
  return <span className={`${styles.statusPill} ${styles[tone]}`}>{children}</span>;
}

function MeasurementGrid() {
  const s = useAppStore();
  const ch1 = s.hardwareFrame?.oscilloscope.ch1 ?? null;
  const ch2 = s.hardwareFrame?.oscilloscope.ch2 ?? null;
  const s1 = useMemo(() => ch1 && s.ch1Enabled ? computeStats(ch1.samples, ch1.frequency) : null, [ch1, s.ch1Enabled]);
  const s2 = useMemo(() => ch2 && s.ch2Enabled ? computeStats(ch2.samples, ch2.frequency) : null, [ch2, s.ch2Enabled]);
  const rows = [
    ['Freq', 'frequency', 'Hz'],
    ['Vpp', 'vpp', 'V'],
    ['Vrms', 'vrms', 'V'],
    ['Duty', 'dutyCycle', '%'],
  ] as const;

  return (
    <div className={styles.measureGrid}>
      {rows.map(([label, key, unit]) => (
        <div key={label} className={styles.measureRow}>
          <span>{label}</span>
          <strong className={styles.ch1Text}>{s1 ? fmtStat(s1[key], unit) : '-'}</strong>
          <strong className={styles.ch2Text}>{s2 ? fmtStat(s2[key], unit) : '-'}</strong>
        </div>
      ))}
    </div>
  );
}

function TileBody({ tileId, expanded }: { tileId: TileId; expanded: boolean }) {
  const s = useAppStore();
  const set = s.set;
  const frame = s.hardwareFrame;
  const ch1 = frame?.oscilloscope.ch1;
  const ch2 = frame?.oscilloscope.ch2;
  const recentPackets = s.packets.slice(-7).reverse();
  const files = s.repoTree?.filter(n => n.type === 'blob').slice(0, 5) ?? [];
  const freqMult = s.funcFreqUnit === 'MHz' ? 1e6 : s.funcFreqUnit === 'kHz' ? 1e3 : 1;

  if (expanded && tileId === 'osc') return <OscilloscopePanel />;
  if (expanded && tileId === 'proto') return <ProtocolPanel />;
  if (expanded && tileId === 'funcgen') return <FuncGenPanel />;
  if (expanded && tileId === 'code') return <CodeContextPanel />;
  if (tileId === 'schematic') return <SchematicPanel expanded={expanded} />;
  if (tileId === 'la') return <LogicAnalyzerPanel />;

  if (tileId === 'osc') {
    return (
      <div className={styles.oscTile}>
        <ScopePreview />
        <div className={styles.scopeFooter}>
          {ch1 && <span><b className={styles.ch1Text}>CH1</b> {fmtFreq(ch1.frequency)} {ch1.vpp.toFixed(2)}Vpp</span>}
          {ch2 && <span><b className={styles.ch2Text}>CH2</b> {fmtFreq(ch2.frequency)} {ch2.vpp.toFixed(2)}Vpp</span>}
        </div>
      </div>
    );
  }

  if (tileId === 'proto') {
    return (
      <div className={styles.protoTable}>
        {recentPackets.length === 0 ? <span className={styles.emptyText}>Listening to mock motor controller bus...</span> : recentPackets.map(pkt => (
          <div key={pkt.id} className={styles.protoRow}>
            <span className={`${styles.protoBadge} ${styles[pkt.protocol.toLowerCase()]}`}>{pkt.protocol}</span>
            <span className={styles.protoDir}>{pkt.direction}</span>
            <span className={styles.protoData}>{pkt.decoded || `${pkt.address ?? ''} ${pkt.register ?? ''} ${pkt.data.slice(0, 4).join(' ')}`}</span>
            <span className={styles.protoAck}>{pkt.ack === false ? 'NACK' : 'ACK'}</span>
          </div>
        ))}
      </div>
    );
  }

  if (tileId === 'measurements') return <MeasurementGrid />;

  if (tileId === 'funcgen') {
    return (
      <div className={styles.funcTile}>
        <div className={styles.funcReadout}>
          <span className={styles.waveGlyph}>{WAVE_ICONS[s.funcWaveform]}</span>
          <div>
            <strong>{fmtFreq(s.funcFrequency * freqMult)}</strong>
            <span>{s.funcAmplitude.toFixed(1)} Vpp, offset {s.funcOffset.toFixed(1)} V</span>
          </div>
        </div>
        <div className={styles.outputLine}>
          <StatusPill tone={s.funcW1 ? 'live' : 'neutral'}>W1 {s.funcW1 ? 'ON' : 'OFF'}</StatusPill>
          <StatusPill tone={s.funcW2 ? 'live' : 'neutral'}>W2 {s.funcW2 ? 'ON' : 'OFF'}</StatusPill>
          <span className={styles.dmmRead}>{s.meterMode} meter</span>
        </div>
      </div>
    );
  }

  if (tileId === 'code') {
    return s.repoOwner ? (
      <div className={styles.codeTile}>
        <strong>{s.repoOwner}/{s.repoName}</strong>
        <span>{s.selectedFile?.path ?? `${s.repoTree?.filter(n => n.type === 'blob').length ?? 0} files indexed`}</span>
        <div className={styles.fileList}>
          {files.map(file => <span key={file.path}>{file.path}</span>)}
        </div>
      </div>
    ) : (
      <div className={styles.emptyState}>
        <Braces size={22} />
        <span>Firmware context slot. Add a GitHub repo when you want the AI to read code with the bench.</span>
      </div>
    );
  }

  if (tileId === 'ai') {
    return (
      <div className={styles.aiTile}>
        <p>{s.lastDebugSummary ?? 'Hit DEBUG when the bench looks wrong. The AI receives traces, packets, trigger settings, readings, and optional notes.'}</p>
        <button
          className={styles.primaryBtn}
          onClick={(e) => { e.stopPropagation(); set({ debugOverlayOpen: true }); }}
        >
          Run Debug <ChevronRight size={14} />
        </button>
      </div>
    );
  }

  // cad tile fallback
  return (
    <div className={styles.emptyState}>
      <Gauge size={22} />
      <span>Robot/CAD context can sit beside the electrical session when assembly geometry matters.</span>
    </div>
  );
}

function tileMeta(tileId: TileId, s: ReturnType<typeof useAppStore.getState>) {
  const live = !s.oscilloscopePaused && s.connectionStatus === 'connected';
  const laStatus = s.laFrame?.la_status ?? 'searching';
  const laChannels = s.laFrame?.config.enabled_channels.length ?? 8;
  const meta: Record<TileId, { title: string; subtitle: string; icon: React.ReactNode; status?: React.ReactNode }> = {
    osc: { title: 'Oscilloscope', subtitle: 'CH1 motor phase · CH2 control', icon: <Activity size={16} />, status: <StatusPill tone={live ? 'live' : 'warn'}>{live ? 'RUN' : 'HOLD'}</StatusPill> },
    la:  { title: 'Logic Analyzer', subtitle: laStatus === 'running' ? `${laChannels}CH · FX2 · 24MHz` : 'FX2 · sigrok', icon: <GitBranch size={16} />, status: <StatusPill tone={laStatus === 'running' ? 'live' : 'neutral'}>{laStatus === 'running' ? 'RUN' : 'IDLE'}</StatusPill> },
    proto: { title: 'Protocol Traffic', subtitle: `${s.packets.length} packets buffered`, icon: <RadioTower size={16} />, status: <StatusPill tone={s.protocolPaused ? 'warn' : 'live'}>{s.protocolPaused ? 'PAUSED' : 'LIVE'}</StatusPill> },
    measurements: { title: 'Measurements', subtitle: 'Freq · Vpp · RMS · duty', icon: <Ruler size={16} /> },
    funcgen: { title: 'Func Gen + DMM', subtitle: 'Stimulus and meter', icon: <Zap size={16} /> },
    code: { title: 'Code Context', subtitle: s.repoOwner ? `${s.repoOwner}/${s.repoName}` : 'No repo loaded', icon: <TerminalSquare size={16} /> },
    ai: { title: 'AI Debug', subtitle: 'Evidence-focused assistant', icon: <Bot size={16} />, status: <StatusPill>{s.isStreaming ? 'THINKING' : 'READY'}</StatusPill> },
    cad: { title: 'CAD Context', subtitle: 'Robot geometry', icon: <Gauge size={16} />, status: <StatusPill>OPTIONAL</StatusPill> },
    schematic: { title: 'Schematic', subtitle: s.schematic ? `${s.schematic.nets.length} nets · ${s.schematic.componentCount} components` : 'Upload .kicad_sch', icon: <Cpu size={16} />, status: s.schematic ? <StatusPill tone="live">LOADED</StatusPill> : <StatusPill>UPLOAD</StatusPill> },
  };
  return meta[tileId];
}

export default function Dashboard() {
  const s = useAppStore();
  const visibleIds = TILE_ORDER.filter(id => s.visibleTiles[id]);
  const expandedTile = s.expandedTile && s.visibleTiles[s.expandedTile] ? s.expandedTile : null;
  const setExpandedTile = s.setExpandedTile;
  const visibleMain = expandedTile ? visibleIds.filter(id => id !== expandedTile) : visibleIds;

  return (
    <div className={styles.workbench}>
      <header className={styles.workbenchHeader}>
        <div>
          <h1>Signals, packets, and code in one debug loop.</h1>
          <p>{expandedTile ? 'Focused instrument, with the rest of the bench docked nearby.' : 'Mock robotics hardware is streaming into the hosted demo.'}</p>
        </div>
        <TilePicker />
      </header>

      {expandedTile ? (
        <div className={styles.focusLayout}>
          <WorkbenchTile
            id={expandedTile}
            {...tileMeta(expandedTile, s)}
            isExpanded
            isHighlighted={s.highlightedTile === expandedTile}
            onExpand={setExpandedTile}
            onCollapse={() => setExpandedTile(null)}
          >
            <TileBody tileId={expandedTile} expanded />
          </WorkbenchTile>
          <aside className={styles.tileDock}>
            {visibleMain.map(tileId => (
              <WorkbenchTile
                key={tileId}
                id={tileId}
                {...tileMeta(tileId, s)}
                isDocked
                isHighlighted={s.highlightedTile === tileId}
                onExpand={setExpandedTile}
              >
                <TileBody tileId={tileId} expanded={false} />
              </WorkbenchTile>
            ))}
          </aside>
        </div>
      ) : (
        <div className={styles.tileGrid}>
          {visibleIds.map(tileId => (
            <WorkbenchTile
              key={tileId}
              id={tileId}
              {...tileMeta(tileId, s)}
              isHighlighted={s.highlightedTile === tileId}
              onExpand={setExpandedTile}
            >
              <TileBody tileId={tileId} expanded={false} />
            </WorkbenchTile>
          ))}
        </div>
      )}
    </div>
  );
}
