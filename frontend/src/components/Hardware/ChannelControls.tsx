import { useAppStore, VOLT_PER_DIV, fmtVDiv } from '../../store/appStore';
import styles from './InstrumentControls.module.css';

// Map display V/div → nearest hardware voltage-range code.
// Hantek codes: 1=±5V (1.25V/div), 2=±2.5V (0.625V/div), 5=±1V (0.25V/div), 10=±0.5V (0.125V/div)
const HW_RANGES = [
  { code: 1,  vpd: 1.25 },
  { code: 2,  vpd: 0.625 },
  { code: 5,  vpd: 0.25 },
  { code: 10, vpd: 0.125 },
];
function vpdToVrCode(vpd: number): number {
  return HW_RANGES.reduce((best, r) =>
    Math.abs(r.vpd - vpd) < Math.abs(best.vpd - vpd) ? r : best
  ).code;
}

export default function ChannelControls() {
  const s = useAppStore();
  const set = s.set;

  const cycleVDiv = (ch: 1 | 2, dir: 1 | -1) => {
    const key = ch === 1 ? 'ch1VoltPerDivIdx' : 'ch2VoltPerDivIdx';
    const cur = ch === 1 ? s.ch1VoltPerDivIdx : s.ch2VoltPerDivIdx;
    const next = Math.max(0, Math.min(VOLT_PER_DIV.length - 1, cur + dir));
    set({ [key]: next } as Parameters<typeof set>[0]);
    // Send hardware voltage range for the new V/div
    s.sendScopeCommand({
      cmd: 'set_voltage_range',
      channel: ch,
      value: vpdToVrCode(VOLT_PER_DIV[next]),
    });
  };

  const ChStrip = ({ ch }: { ch: 1 | 2 }) => {
    const enabled = ch === 1 ? s.ch1Enabled : s.ch2Enabled;
    const coupling = ch === 1 ? s.ch1Coupling : s.ch2Coupling;
    const probe = ch === 1 ? s.ch1Probe : s.ch2Probe;
    const invert = ch === 1 ? s.ch1Invert : s.ch2Invert;
    const vdIdx = ch === 1 ? s.ch1VoltPerDivIdx : s.ch2VoltPerDivIdx;
    const color = ch === 1 ? 'var(--ch1)' : 'var(--ch2)';

    const toggle = (key: string, val: unknown) => set({ [key]: val } as Parameters<typeof set>[0]);

    const toggleChannel = () => {
      const newEnabled = !enabled;
      toggle(ch === 1 ? 'ch1Enabled' : 'ch2Enabled', newEnabled);
      // Only ch2 toggle affects hardware channel count; ch1 is always on
      if (ch === 2) {
        s.sendScopeCommand({ cmd: 'set_channels', value: newEnabled ? 2 : 1 });
      }
    };

    return (
      <div className={styles.chStrip}>
        <button
          className={`${styles.chLabel} ${enabled ? styles.chLabelOn : ''}`}
          style={{ borderColor: enabled ? color : undefined, color: enabled ? color : undefined }}
          onClick={toggleChannel}
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
            title={`×${p.replace('x', '')} display multiplier only`}
            onClick={() => toggle(ch === 1 ? 'ch1Probe' : 'ch2Probe', p)}>
            ×{p.replace('x', '')}
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
