import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../store/appStore';
import styles from './InstrumentControls.module.css';

function mockReading(mode: string, ch1Vrms: number): { primary: number; secondary: number | null } {
  const noise = () => (Math.random() - 0.5) * 0.003;
  if (mode === 'V') return { primary: ch1Vrms + noise(), secondary: 1000 + Math.random() * 5 };
  if (mode === 'A') return { primary: (ch1Vrms / 10) + noise() * 0.01, secondary: null };
  if (mode === 'Ω') return { primary: 4700 + (Math.random() - 0.5) * 20, secondary: null };
  if (mode === 'CONT') return { primary: ch1Vrms < 0.1 ? 0 : 1, secondary: null };
  return { primary: 0, secondary: null };
}

interface Props { inline?: boolean; }

export default function MultimeterPanel({ inline = false }: Props) {
  const [open, setOpen] = useState(false);
  const [primary, setPrimary] = useState(0);
  const [secondary, setSecondary] = useState<number | null>(null);
  const [contPulse, setContPulse] = useState(false);

  const s = useAppStore();
  const set = s.set;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ch1 = s.hardwareFrame?.oscilloscope.ch1;
  const ch1Vrms = ch1 ? Math.sqrt(ch1.vpp ** 2 / 8) : 0;
  const active = inline || open;

  useEffect(() => {
    if (!active) return;
    timerRef.current = setInterval(() => {
      const r = mockReading(s.meterMode, ch1Vrms);
      setPrimary(r.primary);
      setSecondary(r.secondary);
      if (s.meterMode === 'CONT') setContPulse(r.primary < 0.1);
    }, 300);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [active, s.meterMode, ch1Vrms]);

  const fmtPrimary = (): string => {
    if (s.meterMode === 'V') return `${primary >= 0 ? '' : '-'}${Math.abs(primary).toFixed(4)}`;
    if (s.meterMode === 'A') return `${primary >= 0 ? '' : '-'}${Math.abs(primary).toFixed(4)}`;
    if (s.meterMode === 'Ω') return primary > 9999 ? '∞' : primary.toFixed(1);
    if (s.meterMode === 'CONT') return primary < 0.1 ? '●' : '○';
    return '0.0000';
  };
  const primaryUnit = s.meterMode === 'V' ? 'V AC' : s.meterMode === 'A' ? 'A' : s.meterMode === 'Ω' ? 'Ω' : '';

  const body = (
    <>
      <div className={styles.meterDisplay}>
        <span className={`${styles.meterReading} ${s.meterMode === 'CONT' && contPulse ? styles.meterCont : ''}`}>
          {fmtPrimary()}
        </span>
        <span className={styles.meterUnit}>{primaryUnit}</span>
      </div>
      {secondary !== null && <div className={styles.meterSecondary}>{secondary.toFixed(1)} Hz</div>}
      <div className={styles.fgRow} style={{ marginTop: 6 }}>
        {(['V','A','Ω','CONT'] as const).map(m => (
          <button key={m}
            className={`${styles.segBtn} ${s.meterMode === m ? styles.segBtnActive : ''}`}
            onClick={() => set({ meterMode: m })}>{m}</button>
        ))}
      </div>
    </>
  );

  if (inline) return body;

  return (
    <div className={styles.collapsiblePanel}>
      <button className={styles.collapsibleHeader} onClick={() => setOpen(o => !o)}>
        <span className={styles.instrLabel}>MULTIMETER</span>
        <span className={styles.collapseArrow}>{open ? '▼' : '▶'}</span>
        <span className={styles.fgSummary}>{s.meterMode} mode</span>
      </button>
      {open && <div className={styles.collapsibleBody}>{body}</div>}
    </div>
  );
}
