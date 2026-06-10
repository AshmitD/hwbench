import { useEffect, useRef } from 'react';
import { useAppStore, VOLT_PER_DIV } from '../../store/appStore';
import { generateFuncGenSamples } from '../../utils/waveformMath';
import WaveformDisplay from '../Hardware/WaveformDisplay';
import MeasurementsPanel from '../Hardware/MeasurementsPanel';
import ChannelControls from '../Hardware/ChannelControls';
import TriggerControls from '../Hardware/TriggerControls';
import styles from './OscilloscopePanel.module.css';

// Must match VOLT_PER_DIV in appStore
const _VPDS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5];

function _bestVpdIdx(vpp: number): number {
  if (vpp < 0.001) return 0;
  const target = vpp / (8 * 0.75);
  const idx = _VPDS.findIndex(v => v >= target);
  return idx === -1 ? _VPDS.length - 1 : idx;
}

// Autoset timeout — if no autoset_done arrives in this many ms, clear busy state
const AUTOSET_TIMEOUT_MS = 12_000;

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

  const autosetBusy = s.autosetBusy;
  const autosetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Safety net: clear busy if no autoset_done arrives within AUTOSET_TIMEOUT_MS
  useEffect(() => {
    if (!autosetBusy) return;
    autosetTimeoutRef.current = setTimeout(() => {
      if (useAppStore.getState().autosetBusy) {
        s.setAutosetBusy(false);
      }
    }, AUTOSET_TIMEOUT_MS);
    return () => {
      if (autosetTimeoutRef.current) clearTimeout(autosetTimeoutRef.current);
    };
  }, [autosetBusy]); // eslint-disable-line react-hooks/exhaustive-deps

  const Btn = ({ label, active, onClick, title, disabled }: {
    label: string; active?: boolean; onClick: () => void; title?: string; disabled?: boolean;
  }) => (
    <button
      className={`${styles.featureBtn} ${active ? styles.featureBtnOn : ''} ${disabled ? styles.featureBtnDisabled : ''}`}
      onClick={onClick} title={title} disabled={disabled}>
      {label}
    </button>
  );

  // Autoset: server-side for live scope, client-side fallback for mock mode
  const handleAutoset = () => {
    if (autosetBusy) return;

    if (frame?.mode === 'live' && s.scopeStatus === 'connected') {
      // Full server-side autoset — scope hardware does the measurement
      s.setAutosetBusy(true);
      s.sendScopeCommand({ cmd: 'autoset' });
    } else {
      // Client-side fallback (mock mode or scope searching)
      const ch1Samples = ch1?.samples ?? [];
      const ch2Samples = ch2?.samples ?? [];
      const patch: Partial<typeof s> = {};
      if (ch1Samples.length) {
        const vpp = Math.max(...ch1Samples) - Math.min(...ch1Samples);
        const mid = (Math.max(...ch1Samples) + Math.min(...ch1Samples)) / 2;
        patch.ch1VoltPerDivIdx = _bestVpdIdx(vpp);
        patch.triggerLevel  = Math.round(mid * 1000) / 1000;
        patch.triggerSource = 'CH1';
        patch.triggerMode   = 'AUTO';
        patch.triggerEdge   = 'rising';
      }
      if (s.ch2Enabled && ch2Samples.length) {
        const vpp = Math.max(...ch2Samples) - Math.min(...ch2Samples);
        patch.ch2VoltPerDivIdx = _bestVpdIdx(vpp);
      }
      if (Object.keys(patch).length) set(patch as Parameters<typeof set>[0]);
    }
  };

  // SINGLE trigger re-arm: send run command and un-pause
  const handleSingleRearm = () => {
    s.sendScopeCommand({ cmd: 'run' });
    set({ oscilloscopePaused: false });
  };

  return (
    <div className={styles.panel}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarSection}>
          {/* Scope connection badge */}
          {frame?.mode === 'live' && (
            <span className={
              s.scopeStatus === 'connected'
                ? styles.scopeBadgeConnected
                : styles.scopeBadgeSearching
            }>
              {s.scopeStatus === 'connected' ? 'SCOPE' : 'SEARCHING'}
            </span>
          )}
          {frame?.mode === 'mock' && <span className={styles.mockBadge}>MOCK</span>}
          {s.triggerMode === 'SINGLE' && s.oscilloscopePaused
            ? <button className={`${styles.runPauseBtn} ${styles.paused}`} onClick={handleSingleRearm} title="Re-arm SINGLE trigger" disabled={autosetBusy}>
                SINGLE
              </button>
            : <button
                className={`${styles.runPauseBtn} ${s.oscilloscopePaused ? styles.paused : styles.running}`}
                onClick={s.toggleOscilloscopePause} title="Run/Pause (Space)" disabled={autosetBusy}>
                {s.oscilloscopePaused ? 'PAUSED' : 'RUN'}
              </button>
          }
          <button
            className={`${styles.autosetBtn} ${autosetBusy ? styles.autosetBtnBusy : ''}`}
            onClick={handleAutoset}
            disabled={autosetBusy}
            title="Autoset: configure voltage range, trigger, and V/div for the current signal">
            {autosetBusy ? 'AUTOSET…' : 'AUTO'}
          </button>
        </div>
        <div className={styles.toolbarDivider} />
        <div className={styles.toolbarSection}>
          <Btn label="PERSIST" active={s.persistMode} onClick={() => set({ persistMode: !s.persistMode })} disabled={autosetBusy} />
          <Btn label="FFT"     active={s.fftMode}     onClick={() => set({ fftMode: !s.fftMode })} disabled={autosetBusy} />
          <Btn label="CURSORS" active={s.showCursors} onClick={() => set({ showCursors: !s.showCursors })} title="Shift+click to place" disabled={autosetBusy} />
          <Btn label="MATH"    active={s.showMath}    onClick={() => set({ showMath: !s.showMath })} disabled={autosetBusy} />
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
          timeSpanMs={ch1?.time_span_ms ?? 5}
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
