import { useMemo } from 'react';
import { ChannelData } from '../../store/appStore';
import { computeStats, fmtStat } from '../../utils/waveformMath';
import styles from './InstrumentControls.module.css';

interface Props {
  ch1: ChannelData | null;
  ch2: ChannelData | null;
  ch1Enabled: boolean;
  ch2Enabled: boolean;
}

const ROWS: { label: string; key: keyof ReturnType<typeof computeStats>; unit: string }[] = [
  { label: 'Freq',  key: 'frequency', unit: 'Hz' },
  { label: 'Per',   key: 'period',    unit: 'ms' },
  { label: 'Vpp',   key: 'vpp',       unit: 'V'  },
  { label: 'Vmax',  key: 'vmax',      unit: 'V'  },
  { label: 'Vmin',  key: 'vmin',      unit: 'V'  },
  { label: 'Vrms',  key: 'vrms',      unit: 'V'  },
  { label: 'Duty',  key: 'dutyCycle', unit: '%'  },
  { label: 'Rise',  key: 'riseTime',  unit: 'ms' },
];

export default function MeasurementsPanel({ ch1, ch2, ch1Enabled, ch2Enabled }: Props) {
  const s1 = useMemo(() => ch1 && ch1Enabled ? computeStats(ch1.samples, ch1.frequency) : null, [ch1, ch1Enabled]);
  const s2 = useMemo(() => ch2 && ch2Enabled ? computeStats(ch2.samples, ch2.frequency) : null, [ch2, ch2Enabled]);

  return (
    <div className={styles.measPanel}>
      <div className={styles.measHeader}>
        <span className={styles.measSectionLabel}>MEAS</span>
        <span className={styles.measCh} style={{ color: 'var(--ch1)' }}>CH1</span>
        <span className={styles.measCh} style={{ color: 'var(--ch2)' }}>CH2</span>
      </div>
      {ROWS.map(({ label, key, unit }) => (
        <div key={label} className={styles.measRow}>
          <span className={styles.measLabel}>{label}</span>
          <span className={styles.measValue} style={{ color: ch1Enabled ? 'var(--ch1)' : 'var(--text-muted)' }}>
            {s1 ? fmtStat(s1[key] as number, unit) : '—'}
          </span>
          <span className={styles.measValue} style={{ color: ch2Enabled ? 'var(--ch2)' : 'var(--text-muted)' }}>
            {s2 ? fmtStat(s2[key] as number, unit) : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}
