import { useEffect, useRef } from 'react';
import { useAppStore } from '../../store/appStore';
import styles from './Dashboard.module.css';

// ─── Mini sparkline (no grid, just trace shape) ───────────────────────────────
function MiniSparkline({ ch1Samples, ch2Samples }: { ch1Samples: number[]; ch2Samples: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const draw = () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const { width, height } = container.getBoundingClientRect();
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Dark scope background
    ctx.fillStyle = '#1a1814';
    ctx.fillRect(0, 0, width, height);

    const drawTrace = (samples: number[], color: string, range: number) => {
      if (!samples.length) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = color;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      const step = Math.max(1, Math.floor(samples.length / width));
      let first = true;
      for (let i = 0; i < samples.length; i += step) {
        const x = (i / (samples.length - 1)) * width;
        const y = height / 2 - (samples[i] / range) * (height * 0.4);
        first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        first = false;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    };

    drawTrace(ch1Samples, '#0891b2', 3);
    drawTrace(ch2Samples, '#d97706', 5);
  };

  useEffect(() => { draw(); }, [ch1Samples, ch2Samples]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} className={styles.scopeCanvas} />
    </div>
  );
}

// ─── Wave icon ────────────────────────────────────────────────────────────────
const WAVE_ICONS: Record<string, string> = {
  sine: '∿', square: '⊓', triangle: '△', sawtooth: '⟋',
};

function fmtFreq(hz: number): string {
  if (hz >= 1_000_000) return `${(hz / 1_000_000).toFixed(2)} MHz`;
  if (hz >= 1_000) return `${(hz / 1_000).toFixed(2)} kHz`;
  return `${hz.toFixed(0)} Hz`;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const set = useAppStore(s => s.set);
  const frame = useAppStore(s => s.hardwareFrame);
  const packets = useAppStore(s => s.packets);
  const repoName = useAppStore(s => s.repoName);
  const repoOwner = useAppStore(s => s.repoOwner);
  const repoTree = useAppStore(s => s.repoTree);
  const funcWaveform = useAppStore(s => s.funcWaveform);
  const funcFrequency = useAppStore(s => s.funcFrequency);
  const funcFreqUnit = useAppStore(s => s.funcFreqUnit);
  const funcAmplitude = useAppStore(s => s.funcAmplitude);
  const funcW1 = useAppStore(s => s.funcW1);
  const funcW2 = useAppStore(s => s.funcW2);

  const ch1 = frame?.oscilloscope.ch1;
  const ch2 = frame?.oscilloscope.ch2;
  const recentPackets = packets.slice(-6);

  const fmtHz = (hz: number) => hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${hz.toFixed(0)}`;

  const funcFreqDisplay = (() => {
    const mult = funcFreqUnit === 'MHz' ? 1e6 : funcFreqUnit === 'kHz' ? 1e3 : 1;
    return fmtFreq(funcFrequency * mult);
  })();

  const fileList = repoTree?.filter(n => n.type === 'blob').slice(0, 4) ?? [];

  const nav = (panel: 'osc' | 'proto' | 'funcgen' | 'code') => set({ activePanel: panel });

  return (
    <div className={styles.grid}>

      {/* ── Card 1: Oscilloscope ──────────────────────────────────────────── */}
      <div className={styles.card} onClick={() => nav('osc')}>
        <div className={styles.cardHeader}>
          <span className={styles.cardLabel}>Oscilloscope</span>
          <div className={styles.liveDot} />
        </div>
        <div className={styles.cardBody}>
          <div className={styles.scopeArea}>
            <MiniSparkline
              ch1Samples={ch1?.samples ?? []}
              ch2Samples={ch2?.samples ?? []}
            />
          </div>
          <div className={styles.scopeStats}>
            {ch1 && (
              <div className={styles.channelStat}>
                <span className={`${styles.chTag} ${styles.ch1Tag}`}>CH1</span>
                <span className={styles.chVal}>{fmtHz(ch1.frequency)}Hz</span>
                <span className={styles.chSub}>{ch1.vpp.toFixed(2)}Vpp</span>
              </div>
            )}
            {ch2 && (
              <div className={styles.channelStat}>
                <span className={`${styles.chTag} ${styles.ch2Tag}`}>CH2</span>
                <span className={styles.chVal}>{fmtHz(ch2.frequency)}Hz</span>
                <span className={styles.chSub}>{ch2.vpp.toFixed(2)}Vpp</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Card 2: Protocol ──────────────────────────────────────────────── */}
      <div className={styles.card} onClick={() => nav('proto')}>
        <div className={styles.cardHeader}>
          <span className={styles.cardLabel}>Protocol Decoder</span>
          <div className={styles.liveDot} />
        </div>
        <div className={styles.cardBody}>
          <div className={styles.protoList}>
            {recentPackets.length === 0 ? (
              <span className={styles.protoEmpty}>No packets yet…</span>
            ) : (
              recentPackets.map(pkt => {
                const badgeCls = pkt.protocol === 'I2C' ? styles.i2cBadge : pkt.protocol === 'SPI' ? styles.spiBadge : styles.uartBadge;
                const decoded = pkt.decoded || `${pkt.data.slice(0, 4).join(' ')}`;
                return (
                  <div key={pkt.id} className={styles.protoRow}>
                    <span className={`${styles.protoBadge} ${badgeCls}`}>{pkt.protocol}</span>
                    <span className={styles.protoDecoded}>{decoded}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── Card 3: Function Generator ────────────────────────────────────── */}
      <div className={styles.card} onClick={() => nav('funcgen')}>
        <div className={styles.cardHeader}>
          <span className={styles.cardLabel}>Function Generator</span>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.funcRow}>
            <span className={styles.funcWaveIcon}>{WAVE_ICONS[funcWaveform] ?? '∿'}</span>
            <div className={styles.funcMain}>
              <span className={styles.funcFreq}>{funcFreqDisplay}</span>
              <span className={styles.funcAmp}>{funcAmplitude} Vpp</span>
            </div>
          </div>
          <div className={styles.outputPills}>
            <span className={`${styles.outputPill} ${funcW1 ? styles.pillOn : styles.pillOff}`}>W1</span>
            <span className={`${styles.outputPill} ${funcW2 ? styles.pillOn : styles.pillOff}`}>W2</span>
          </div>
          <span className={styles.expandHint}>Click to configure →</span>
        </div>
      </div>

      {/* ── Card 4: Code Context ──────────────────────────────────────────── */}
      <div className={styles.card} onClick={() => nav('code')}>
        <div className={styles.cardHeader}>
          <span className={styles.cardLabel}>Code Context</span>
        </div>
        <div className={styles.cardBody}>
          {!repoOwner ? (
            <div className={styles.codeEmpty}>
              <span className={styles.codeEmptyIcon}>⌥</span>
              <span className={styles.codeEmptyText}>Add a GitHub repository for deeper AI insights</span>
            </div>
          ) : (
            <>
              <span className={styles.repoName}>{repoOwner}/{repoName}</span>
              <span className={styles.repoMeta}>{repoTree?.filter(n => n.type === 'blob').length ?? '—'} files</span>
              <div className={styles.fileTree}>
                {fileList.map(f => (
                  <div key={f.path} className={styles.fileRow}>
                    <span className={styles.fileIcon}>·</span>
                    <span>{f.path.split('/').pop()}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

    </div>
  );
}
