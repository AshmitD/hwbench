import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import styles from './InstrumentControls.module.css';

export default function FunctionGeneratorPanel() {
  const [open, setOpen] = useState(false);
  const s = useAppStore();
  const set = s.set;

  const freqHz = s.funcFrequency * (s.funcFreqUnit === 'MHz' ? 1e6 : s.funcFreqUnit === 'kHz' ? 1e3 : 1);

  return (
    <div className={styles.collapsiblePanel}>
      <button className={styles.collapsibleHeader} onClick={() => setOpen(o => !o)}>
        <span className={styles.instrLabel}>FUNC GEN</span>
        <span className={styles.collapseArrow}>{open ? '▼' : '▶'}</span>
        <span className={styles.fgSummary}>
          {s.funcWaveform.toUpperCase()} {s.funcFrequency}{s.funcFreqUnit} {s.funcAmplitude}Vpp
          {s.funcW1 && <span style={{ color: 'var(--ch1)', marginLeft: 6 }}>W1</span>}
          {s.funcW2 && <span style={{ color: 'var(--ch2)', marginLeft: 4 }}>W2</span>}
        </span>
      </button>

      {open && (
        <div className={styles.collapsibleBody}>
          <div className={styles.fgRow}>
            <span className={styles.instrLabel}>WAVE</span>
            {(['sine', 'square', 'triangle', 'sawtooth'] as const).map(w => (
              <button key={w}
                className={`${styles.segBtn} ${s.funcWaveform === w ? styles.segBtnActive : ''}`}
                style={s.funcWaveform === w ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : undefined}
                onClick={() => set({ funcWaveform: w })}>
                {w === 'sine' ? '∿' : w === 'square' ? '⊓' : w === 'triangle' ? '△' : '⟋'}
              </button>
            ))}
          </div>

          <div className={styles.fgRow}>
            <span className={styles.instrLabel}>FREQ</span>
            <input
              className={styles.numInput}
              type="number"
              value={s.funcFrequency}
              min="0.001"
              step="0.1"
              onChange={e => set({ funcFrequency: parseFloat(e.target.value) || 1 })}
            />
            {(['Hz', 'kHz', 'MHz'] as const).map(u => (
              <button key={u}
                className={`${styles.segBtn} ${s.funcFreqUnit === u ? styles.segBtnActive : ''}`}
                style={s.funcFreqUnit === u ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : undefined}
                onClick={() => set({ funcFreqUnit: u })}>
                {u}
              </button>
            ))}
            <span className={styles.instrLabel} style={{ marginLeft: 4, color: 'var(--text-muted)' }}>
              {freqHz >= 1e6 ? `${(freqHz / 1e6).toFixed(3)}MHz` : freqHz >= 1e3 ? `${(freqHz / 1e3).toFixed(3)}kHz` : `${freqHz.toFixed(1)}Hz`}
            </span>
          </div>

          <div className={styles.fgRow}>
            <span className={styles.instrLabel}>AMP</span>
            <input
              className={styles.numInput}
              type="number"
              value={s.funcAmplitude}
              min="0.001"
              step="0.1"
              onChange={e => set({ funcAmplitude: parseFloat(e.target.value) || 1 })}
            />
            <span className={styles.instrLabel}>Vpp</span>
            <span className={styles.gap} />
            <span className={styles.instrLabel}>OFS</span>
            <input
              className={styles.numInput}
              type="number"
              value={s.funcOffset}
              step="0.1"
              onChange={e => set({ funcOffset: parseFloat(e.target.value) || 0 })}
            />
            <span className={styles.instrLabel}>V</span>
          </div>

          <div className={styles.fgRow}>
            <button
              className={`${styles.outputBtn} ${s.funcW1 ? styles.outputBtnOn : ''}`}
              style={s.funcW1 ? { color: 'var(--ch1)', borderColor: 'var(--ch1)', background: 'rgba(34,211,238,0.08)' } : undefined}
              onClick={() => set({ funcW1: !s.funcW1 })}>
              W1 {s.funcW1 ? 'ON' : 'OFF'}
            </button>
            <button
              className={`${styles.outputBtn} ${s.funcW2 ? styles.outputBtnOn : ''}`}
              style={s.funcW2 ? { color: 'var(--ch2)', borderColor: 'var(--ch2)', background: 'rgba(245,158,11,0.08)' } : undefined}
              onClick={() => set({ funcW2: !s.funcW2 })}>
              W2 {s.funcW2 ? 'ON' : 'OFF'}
            </button>
            {s.funcW2 && (
              <span className={styles.instrLabel} style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                ↳ overrides CH2 display
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
