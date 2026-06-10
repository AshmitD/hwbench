import { useEffect } from 'react';
import { useAppStore, VOLT_PER_DIV } from '../../store/appStore';
import { generateFuncGenSamples } from '../../utils/waveformMath';
import WaveformDisplay from './WaveformDisplay';
import MeasurementsPanel from './MeasurementsPanel';
import ChannelControls from './ChannelControls';
import TriggerControls from './TriggerControls';
import ProtocolTraffic from './ProtocolTraffic';
import FunctionGeneratorPanel from './FunctionGeneratorPanel';
import MultimeterPanel from './MultimeterPanel';
import styles from './HardwarePanel.module.css';

export default function HardwarePanel() {
  const frame = useAppStore(s => s.hardwareFrame);
  const packets = useAppStore(s => s.packets);
  const set = useAppStore(s => s.set);

  // Feature flags
  const oscilloscopePaused = useAppStore(s => s.oscilloscopePaused);
  const protocolPaused = useAppStore(s => s.protocolPaused);
  const persistMode = useAppStore(s => s.persistMode);
  const fftMode = useAppStore(s => s.fftMode);
  const showCursors = useAppStore(s => s.showCursors);
  const showMath = useAppStore(s => s.showMath);
  const mathOperation = useAppStore(s => s.mathOperation);
  const toggleOscilloscopePause = useAppStore(s => s.toggleOscilloscopePause);
  const toggleProtocolPause = useAppStore(s => s.toggleProtocolPause);

  // Channel settings
  const ch1Enabled = useAppStore(s => s.ch1Enabled);
  const ch2Enabled = useAppStore(s => s.ch2Enabled);
  const ch1Coupling = useAppStore(s => s.ch1Coupling);
  const ch2Coupling = useAppStore(s => s.ch2Coupling);
  const ch1Probe = useAppStore(s => s.ch1Probe);
  const ch2Probe = useAppStore(s => s.ch2Probe);
  const ch1Invert = useAppStore(s => s.ch1Invert);
  const ch2Invert = useAppStore(s => s.ch2Invert);
  const ch1VoltPerDivIdx = useAppStore(s => s.ch1VoltPerDivIdx);
  const ch2VoltPerDivIdx = useAppStore(s => s.ch2VoltPerDivIdx);

  // Trigger
  const triggerSource = useAppStore(s => s.triggerSource);
  const triggerMode = useAppStore(s => s.triggerMode);
  const triggerLevel = useAppStore(s => s.triggerLevel);

  // Acquisition
  const acqMode = useAppStore(s => s.acqMode);
  const acqAvgN = useAppStore(s => s.acqAvgN);

  // Function generator
  const funcW2 = useAppStore(s => s.funcW2);
  const funcWaveform = useAppStore(s => s.funcWaveform);
  const funcFrequency = useAppStore(s => s.funcFrequency);
  const funcFreqUnit = useAppStore(s => s.funcFreqUnit);
  const funcAmplitude = useAppStore(s => s.funcAmplitude);
  const funcOffset = useAppStore(s => s.funcOffset);

  const ch1 = frame?.oscilloscope.ch1 ?? null;
  const ch2 = frame?.oscilloscope.ch2 ?? null;
  const ch1VPD = VOLT_PER_DIV[ch1VoltPerDivIdx];
  const ch2VPD = VOLT_PER_DIV[ch2VoltPerDivIdx];

  // Build funcGen override for CH2
  const ch2Override = funcW2
    ? (() => {
        const freqHz = funcFrequency * (funcFreqUnit === 'MHz' ? 1e6 : funcFreqUnit === 'kHz' ? 1e3 : 1);
        return generateFuncGenSamples(funcWaveform, freqHz, funcAmplitude, funcOffset);
      })()
    : null;

  // Spacebar: pause both
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        toggleOscilloscopePause();
        toggleProtocolPause();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleOscilloscopePause, toggleProtocolPause]);

  // SINGLE trigger mode: auto-pause after one frame
  useEffect(() => {
    if (triggerMode === 'SINGLE' && frame && !oscilloscopePaused) {
      set({ oscilloscopePaused: true });
    }
  }, [frame, triggerMode, oscilloscopePaused, set]);

  const ScopeBtn = ({
    label, active, onClick, title,
  }: { label: string; active?: boolean; onClick: () => void; title?: string }) => (
    <button
      className={`${styles.scopeFeatureBtn} ${active ? styles.scopeFeatureBtnOn : ''}`}
      onClick={onClick}
      title={title}
    >
      {label}
    </button>
  );

  return (
    <div className={styles.panel}>
      {/* ── Oscilloscope header ─────────────────────────────────── */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.title}>OSC</span>
          {frame?.mode === 'mock' && <span className={styles.mockBadge}>MOCK</span>}
          <button
            className={`${styles.runPauseBtn} ${oscilloscopePaused ? styles.paused : styles.running}`}
            onClick={toggleOscilloscopePause}
            title="Run/Pause (Space)"
          >
            {oscilloscopePaused ? '⏸' : '▶'}
          </button>
        </div>
        <div className={styles.scopeFeatureBtns}>
          <ScopeBtn label="PERSIST" active={persistMode} onClick={() => set({ persistMode: !persistMode })} title="Phosphor persistence" />
          <ScopeBtn label="FFT" active={fftMode} onClick={() => set({ fftMode: !fftMode })} title="Frequency domain" />
          <ScopeBtn label="CURSORS" active={showCursors} onClick={() => set({ showCursors: !showCursors })} title="Shift+click to place cursors" />
          <ScopeBtn label="MATH" active={showMath} onClick={() => set({ showMath: !showMath })} title="Math channel" />
          {showMath && (
            <select
              className={styles.mathSelect}
              value={mathOperation}
              onChange={e => set({ mathOperation: e.target.value as 'CH1+CH2' | 'CH1-CH2' | 'CH1×CH2' })}
            >
              {['CH1+CH2', 'CH1-CH2', 'CH1×CH2'].map(op => <option key={op}>{op}</option>)}
            </select>
          )}
        </div>
        <div className={styles.statsBar}>
          {oscilloscopePaused ? (
            <span className={styles.pausedStats}>frozen</span>
          ) : (
            <>
              {ch1 && ch1Enabled && (
                <span className={styles.stat}>
                  <span className={styles.ch1}>CH1</span>
                  <span className={styles.statVal}>{ch1.frequency >= 1000 ? `${(ch1.frequency / 1000).toFixed(1)}k` : ch1.frequency.toFixed(0)}Hz</span>
                  <span className={styles.statDim}>{ch1.vpp.toFixed(2)}Vpp</span>
                </span>
              )}
              {ch2 && ch2Enabled && !funcW2 && (
                <span className={styles.stat}>
                  <span className={styles.ch2}>CH2</span>
                  <span className={styles.statVal}>{ch2.frequency >= 1000 ? `${(ch2.frequency / 1000).toFixed(1)}k` : ch2.frequency.toFixed(0)}Hz</span>
                  <span className={styles.statDim}>{ch2.vpp.toFixed(2)}Vpp</span>
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Waveform ───────────────────────────────────────────── */}
      <div className={styles.waveformSection}>
        <WaveformDisplay
          ch1={ch1}
          ch2={ch2}
          paused={oscilloscopePaused}
          persistMode={persistMode}
          fftMode={fftMode}
          showCursors={showCursors}
          showMath={showMath}
          mathOperation={mathOperation}
          ch1Enabled={ch1Enabled}
          ch2Enabled={ch2Enabled}
          ch1Coupling={ch1Coupling}
          ch2Coupling={ch2Coupling}
          ch1Probe={ch1Probe}
          ch2Probe={ch2Probe}
          ch1Invert={ch1Invert}
          ch2Invert={ch2Invert}
          ch1VoltPerDiv={ch1VPD}
          ch2VoltPerDiv={ch2VPD}
          triggerLevel={triggerLevel}
          triggerSource={triggerSource}
          onTriggerLevelChange={v => set({ triggerLevel: v })}
          acqMode={acqMode}
          acqAvgN={acqAvgN}
          ch2Override={ch2Override}
          timeSpanMs={ch1?.time_span_ms ?? 5}
        />
      </div>

      {/* ── Measurements ──────────────────────────────────────── */}
      <MeasurementsPanel ch1={ch1} ch2={ch2} ch1Enabled={ch1Enabled} ch2Enabled={ch2Enabled} />

      {/* ── Channel + Trigger controls ────────────────────────── */}
      <ChannelControls />
      <TriggerControls />

      {/* ── Protocol decoder ──────────────────────────────────── */}
      <div className={styles.protocolSection}>
        <div className={styles.protocolHeader}>
          <span className={styles.protocolTitle}>PROTO</span>
          <span className={`${styles.protocolBadge} ${styles.i2cBadge}`}>I2C</span>
          <span className={`${styles.protocolBadge} ${styles.spiBadge}`}>SPI</span>
          <span className={`${styles.protocolBadge} ${styles.uartBadge}`}>UART</span>
          <button
            className={`${styles.runPauseBtn} ${protocolPaused ? styles.paused : styles.running}`}
            onClick={toggleProtocolPause}
            style={{ marginLeft: 'auto' }}
          >
            {protocolPaused ? '⏸' : '▶'}
          </button>
        </div>
        <ProtocolTraffic packets={packets} paused={protocolPaused} />
      </div>

      {/* ── Collapsible instrument panels ─────────────────────── */}
      <FunctionGeneratorPanel />
      <MultimeterPanel />
    </div>
  );
}
