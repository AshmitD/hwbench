import { useEffect } from 'react';
import { useAppStore, VOLT_PER_DIV } from '../../store/appStore';
import { generateFuncGenSamples } from '../../utils/waveformMath';
import WaveformDisplay from '../Hardware/WaveformDisplay';
import MeasurementsPanel from '../Hardware/MeasurementsPanel';
import ChannelControls from '../Hardware/ChannelControls';
import TriggerControls from '../Hardware/TriggerControls';
import styles from './OscilloscopePanel.module.css';

export default function OscilloscopePanel() {
  const s = useAppStore();
  const set = s.set;

  const frame = s.hardwareFrame;
  const ch1 = frame?.oscilloscope.ch1 ?? null;
  const ch2 = frame?.oscilloscope.ch2 ?? null;
  const ch1VPD = VOLT_PER_DIV[s.ch1VoltPerDivIdx];
  const ch2VPD = VOLT_PER_DIV[s.ch2VoltPerDivIdx];

  const ch2Override = s.funcW2
    ? (() => {
        const hz = s.funcFrequency * (s.funcFreqUnit === 'MHz' ? 1e6 : s.funcFreqUnit === 'kHz' ? 1e3 : 1);
        return generateFuncGenSamples(s.funcWaveform, hz, s.funcAmplitude, s.funcOffset);
      })()
    : null;

  // Spacebar: pause both
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); s.toggleOscilloscopePause(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [s.toggleOscilloscopePause]); // eslint-disable-line react-hooks/exhaustive-deps

  // SINGLE trigger: auto-pause after one frame
  useEffect(() => {
    if (s.triggerMode === 'SINGLE' && frame && !s.oscilloscopePaused) {
      set({ oscilloscopePaused: true });
    }
  }, [frame, s.triggerMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const Btn = ({ label, active, onClick, title }: { label: string; active?: boolean; onClick: () => void; title?: string }) => (
    <button className={`${styles.featureBtn} ${active ? styles.featureBtnOn : ''}`} onClick={onClick} title={title}>{label}</button>
  );

  return (
    <div className={styles.panel}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarSection}>
          {frame?.mode === 'mock' && <span className={styles.mockBadge}>MOCK</span>}
          <button
            className={`${styles.runPauseBtn} ${s.oscilloscopePaused ? styles.paused : styles.running}`}
            onClick={s.toggleOscilloscopePause} title="Run/Pause (Space)">
            {s.oscilloscopePaused ? '⏸ PAUSED' : '▶ RUN'}
          </button>
        </div>
        <div className={styles.toolbarDivider} />
        <div className={styles.toolbarSection}>
          <Btn label="PERSIST" active={s.persistMode} onClick={() => set({ persistMode: !s.persistMode })} />
          <Btn label="FFT"     active={s.fftMode}     onClick={() => set({ fftMode: !s.fftMode })} />
          <Btn label="CURSORS" active={s.showCursors} onClick={() => set({ showCursors: !s.showCursors })} title="Shift+click to place" />
          <Btn label="MATH"    active={s.showMath}    onClick={() => set({ showMath: !s.showMath })} />
          {s.showMath && (
            <select className={styles.mathSelect} value={s.mathOperation}
              onChange={e => set({ mathOperation: e.target.value as typeof s.mathOperation })}>
              {['CH1+CH2','CH1-CH2','CH1×CH2'].map(op => <option key={op}>{op}</option>)}
            </select>
          )}
        </div>
        <div className={styles.statsBar}>
          {s.oscilloscopePaused
            ? <span className={styles.pausedLabel}>frozen frame</span>
            : <>
                {ch1 && s.ch1Enabled && (
                  <span className={styles.stat}>
                    <span className={styles.ch1Tag}>CH1</span>
                    <span className={styles.statVal}>{ch1.frequency >= 1000 ? `${(ch1.frequency/1000).toFixed(1)}k` : ch1.frequency.toFixed(0)}Hz</span>
                    <span className={styles.statSub}>{ch1.vpp.toFixed(2)}Vpp</span>
                  </span>
                )}
                {ch2 && s.ch2Enabled && (
                  <span className={styles.stat}>
                    <span className={styles.ch2Tag}>CH2</span>
                    <span className={styles.statVal}>{ch2.frequency >= 1000 ? `${(ch2.frequency/1000).toFixed(1)}k` : ch2.frequency.toFixed(0)}Hz</span>
                    <span className={styles.statSub}>{ch2.vpp.toFixed(2)}Vpp</span>
                  </span>
                )}
              </>
          }
        </div>
      </div>

      {/* Waveform */}
      <div className={styles.waveformArea}>
        <WaveformDisplay
          ch1={ch1} ch2={ch2} paused={s.oscilloscopePaused}
          persistMode={s.persistMode} fftMode={s.fftMode}
          showCursors={s.showCursors} showMath={s.showMath} mathOperation={s.mathOperation}
          ch1Enabled={s.ch1Enabled} ch2Enabled={s.ch2Enabled}
          ch1Coupling={s.ch1Coupling} ch2Coupling={s.ch2Coupling}
          ch1Probe={s.ch1Probe} ch2Probe={s.ch2Probe}
          ch1Invert={s.ch1Invert} ch2Invert={s.ch2Invert}
          ch1VoltPerDiv={ch1VPD} ch2VoltPerDiv={ch2VPD}
          triggerLevel={s.triggerLevel} triggerSource={s.triggerSource}
          onTriggerLevelChange={v => set({ triggerLevel: v })}
          acqMode={s.acqMode} acqAvgN={s.acqAvgN}
          ch2Override={ch2Override}
        />
      </div>

      {/* Sub-panels */}
      <div className={styles.subPanels}>
        <MeasurementsPanel ch1={ch1} ch2={ch2} ch1Enabled={s.ch1Enabled} ch2Enabled={s.ch2Enabled} />
        <ChannelControls />
        <TriggerControls />
      </div>
    </div>
  );
}
