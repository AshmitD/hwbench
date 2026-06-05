import { useAppStore, VOLT_PER_DIV, fmtVDiv } from '../../store/appStore';
import styles from './InstrumentControls.module.css';

export default function ChannelControls() {
  const s = useAppStore();
  const set = s.set;

  const cycleVDiv = (ch: 1 | 2, dir: 1 | -1) => {
    const key = ch === 1 ? 'ch1VoltPerDivIdx' : 'ch2VoltPerDivIdx';
    const cur = ch === 1 ? s.ch1VoltPerDivIdx : s.ch2VoltPerDivIdx;
    const next = Math.max(0, Math.min(VOLT_PER_DIV.length - 1, cur + dir));
    set({ [key]: next } as Parameters<typeof set>[0]);
  };

  const ChStrip = ({ ch }: { ch: 1 | 2 }) => {
    const enabled = ch === 1 ? s.ch1Enabled : s.ch2Enabled;
    const coupling = ch === 1 ? s.ch1Coupling : s.ch2Coupling;
    const probe = ch === 1 ? s.ch1Probe : s.ch2Probe;
    const invert = ch === 1 ? s.ch1Invert : s.ch2Invert;
    const vdIdx = ch === 1 ? s.ch1VoltPerDivIdx : s.ch2VoltPerDivIdx;
    const color = ch === 1 ? 'var(--ch1)' : 'var(--ch2)';

    const toggle = (key: string, val: unknown) => set({ [key]: val } as Parameters<typeof set>[0]);

    return (
      <div className={styles.chStrip}>
        <button
          className={`${styles.chLabel} ${enabled ? styles.chLabelOn : ''}`}
          style={{ borderColor: enabled ? color : undefined, color: enabled ? color : undefined }}
          onClick={() => toggle(ch === 1 ? 'ch1Enabled' : 'ch2Enabled', !enabled)}
        >
          CH{ch}
        </button>

        {(['DC', 'AC', 'GND'] as const).map(c => (
          <button key={c} className={`${styles.segBtn} ${coupling === c ? styles.segBtnActive : ''}`}
            style={coupling === c ? { color, borderColor: color } : undefined}
            onClick={() => toggle(ch === 1 ? 'ch1Coupling' : 'ch2Coupling', c)}>
            {c}
          </button>
        ))}

        <div className={styles.gap} />

        {(['1x', '10x', '100x'] as const).map(p => (
          <button key={p} className={`${styles.segBtn} ${probe === p ? styles.segBtnActive : ''}`}
            style={probe === p ? { color, borderColor: color } : undefined}
            onClick={() => toggle(ch === 1 ? 'ch1Probe' : 'ch2Probe', p)}>
            {p}
          </button>
        ))}

        <div className={styles.gap} />

        <button className={styles.iconBtn} onClick={() => cycleVDiv(ch, -1)} title="Decrease V/div">−</button>
        <span className={styles.vdivLabel} style={{ color }} onClick={() => cycleVDiv(ch, 1)}>
          {fmtVDiv(VOLT_PER_DIV[vdIdx])}/div
        </span>
        <button className={styles.iconBtn} onClick={() => cycleVDiv(ch, 1)} title="Increase V/div">+</button>

        <div className={styles.gap} />

        <button
          className={`${styles.segBtn} ${invert ? styles.segBtnActive : ''}`}
          style={invert ? { color, borderColor: color } : undefined}
          onClick={() => toggle(ch === 1 ? 'ch1Invert' : 'ch2Invert', !invert)}
          title="Invert channel">
          INV
        </button>
      </div>
    );
  };

  return (
    <div className={styles.chControls}>
      <ChStrip ch={1} />
      <ChStrip ch={2} />
    </div>
  );
}
