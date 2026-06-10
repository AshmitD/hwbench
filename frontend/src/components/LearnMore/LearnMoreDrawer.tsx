import { Activity, Bot, Code2, RadioTower, Ruler, X, Zap } from 'lucide-react';
import { HighlightTarget, useAppStore } from '../../store/appStore';
import styles from './LearnMoreDrawer.module.css';

const FEATURES: Array<{ target: HighlightTarget; icon: React.ReactNode; label: string; copy: string }> = [
  { target: 'osc', icon: <Activity size={16} />, label: 'Signals', copy: 'Scope traces, FFT, cursors, trigger config, and measurements.' },
  { target: 'proto', icon: <RadioTower size={16} />, label: 'Protocols', copy: 'I2C, SPI, and UART read/write rows attached to the same session.' },
  { target: 'measurements', icon: <Ruler size={16} />, label: 'Readings', copy: 'Frequency, Vpp, RMS, duty cycle, and DMM context.' },
  { target: 'code', icon: <Code2 size={16} />, label: 'Code', copy: 'GitHub repo and selected firmware files for cross-layer clues.' },
  { target: 'funcgen', icon: <Zap size={16} />, label: 'Stimulus', copy: 'Function generator settings and meter readings beside the scope.' },
  { target: 'debug', icon: <Bot size={16} />, label: 'AI Debug', copy: 'Evidence-based suggestions from the current bench snapshot.' },
];

export default function LearnMoreDrawer() {
  const open = useAppStore(s => s.learnMoreOpen);
  const setLearnMoreOpen = useAppStore(s => s.setLearnMoreOpen);
  const setHighlightedTile = useAppStore(s => s.setHighlightedTile);
  const setDebugOverlayOpen = useAppStore(s => s.setDebugOverlayOpen);
  const setLocalRunOpen = useAppStore(s => s.setLocalRunOpen);
  const replayGuidedHotspots = useAppStore(s => s.replayGuidedHotspots);
  const frame = useAppStore(s => s.hardwareFrame);
  const packets = useAppStore(s => s.packets);

  if (!open) return null;

  const highlight = (target: HighlightTarget) => {
    setHighlightedTile(target);
    if (target === 'debug') setDebugOverlayOpen(true);
    window.setTimeout(() => setHighlightedTile(null), 2600);
  };

  return (
    <div className={styles.layer}>
      <button className={styles.backdrop} onClick={() => setLearnMoreOpen(false)} aria-label="Close product drawer" />
      <aside className={styles.drawer} aria-label="Learn more about HWBench">
        <header className={styles.header}>
          <span className={styles.kicker}>What this bench is showing</span>
          <button onClick={() => setLearnMoreOpen(false)} aria-label="Close drawer"><X size={16} /></button>
          <h2>HWBench is a debugging bench for robotics hardware.</h2>
          <p>Signals, bus traffic, firmware context, readings, and AI analysis stay attached to one hardware session.</p>
        </header>

        <section className={styles.liveBox}>
          <h3>Live-ish demo feed</h3>
          <div>
            <span>CH1 motor/sensor signal</span><strong>{frame?.oscilloscope.ch1?.frequency ? `${(frame.oscilloscope.ch1.frequency / 1000).toFixed(1)} kHz` : 'waiting'}</strong>
          </div>
          <div>
            <span>CH2 control signal</span><strong>{frame?.oscilloscope.ch2?.vpp.toFixed(2) ?? '--'} Vpp</strong>
          </div>
          <div>
            <span>Latest packet</span><strong>{packets.at(-1)?.decoded ?? 'Listening to mock motor controller bus'}</strong>
          </div>
        </section>

        <section>
          <h3>Why this matters</h3>
          <p>Most hardware bugs are cross-layer. A motor issue might look like a bad waveform, a protocol timeout, a wrong firmware constant, or a noisy rail. HWBench keeps those clues together.</p>
        </section>

        <section>
          <h3>What HWBench connects</h3>
          <div className={styles.featureList}>
            {FEATURES.map(feature => (
              <button key={feature.label} onClick={() => highlight(feature.target)}>
                <span>{feature.icon}</span>
                <strong>{feature.label}</strong>
                <em>{feature.copy}</em>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>Where AI helps</h3>
          <p>HWBench does not just ask a chatbot what might be wrong. It sends waveform stats, packets, trigger settings, generator config, readings, code context, and optional notes. If the evidence is weak, it should say so.</p>
        </section>

        <section className={styles.tryBox}>
          <button onClick={() => highlight('osc')}>Highlight oscilloscope</button>
          <button onClick={() => highlight('proto')}>Highlight protocol stream</button>
          <button onClick={() => highlight('debug')}>Open AI Debug</button>
          <button onClick={() => setLocalRunOpen(true)}>Show local setup</button>
          <button onClick={replayGuidedHotspots}>Replay tour</button>
        </section>
      </aside>
    </div>
  );
}
