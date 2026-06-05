import { useAppStore } from '../../store/appStore';
import styles from './InstrumentControls.module.css';

export default function TriggerControls() {
  const s = useAppStore();
  const set = s.set;

  return (
    <div className={styles.trigRow}>
      <span className={styles.instrLabel}>TRIG</span>

      {(['CH1', 'CH2'] as const).map(src => (
        <button key={src}
          className={`${styles.segBtn} ${s.triggerSource === src ? styles.segBtnActive : ''}`}
          style={s.triggerSource === src ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : undefined}
          onClick={() => set({ triggerSource: src })}>
          {src}
        </button>
      ))}

      <div className={styles.gap} />

      <button
        className={`${styles.segBtn} ${s.triggerEdge === 'rising' ? styles.segBtnActive : ''}`}
        style={s.triggerEdge === 'rising' ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : undefined}
        onClick={() => set({ triggerEdge: 'rising' })}
        title="Rising edge">↑</button>
      <button
        className={`${styles.segBtn} ${s.triggerEdge === 'falling' ? styles.segBtnActive : ''}`}
        style={s.triggerEdge === 'falling' ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : undefined}
        onClick={() => set({ triggerEdge: 'falling' })}
        title="Falling edge">↓</button>

      <div className={styles.gap} />

      {(['AUTO', 'NORM', 'SINGLE'] as const).map(m => (
        <button key={m}
          className={`${styles.segBtn} ${s.triggerMode === m ? styles.segBtnActive : ''}`}
          style={s.triggerMode === m ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : undefined}
          onClick={() => set({ triggerMode: m })}>
          {m}
        </button>
      ))}

      <div className={styles.gap} />

      <span className={styles.instrLabel} style={{ color: 'var(--uart)' }}>
        {s.triggerLevel >= 0 ? '+' : ''}{s.triggerLevel.toFixed(2)}V
      </span>

      <div className={styles.gap} />

      <span className={styles.instrLabel}>ACQ</span>
      {(['NORM', 'PEAK', 'AVG'] as const).map(m => (
        <button key={m}
          className={`${styles.segBtn} ${s.acqMode === m ? styles.segBtnActive : ''}`}
          style={s.acqMode === m ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : undefined}
          onClick={() => set({ acqMode: m })}>
          {m}
        </button>
      ))}

      {s.acqMode === 'AVG' && (
        <>
          <span className={styles.instrLabel}>N:</span>
          {([2, 4, 8, 16, 32, 64] as const).map(n => (
            <button key={n}
              className={`${styles.segBtn} ${s.acqAvgN === n ? styles.segBtnActive : ''}`}
              style={s.acqAvgN === n ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : undefined}
              onClick={() => set({ acqAvgN: n })}>
              {n}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
