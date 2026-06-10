import { Activity, Code2, RadioTower, Zap } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import styles from './BenchSnapshotStrip.module.css';

function fmtHz(hz?: number) {
  if (!hz) return 'waiting';
  if (hz >= 1000) return `${(hz / 1000).toFixed(1)} kHz`;
  return `${hz.toFixed(0)} Hz`;
}

export default function BenchSnapshotStrip() {
  const frame = useAppStore(s => s.hardwareFrame);
  const packets = useAppStore(s => s.packets);
  const scenario = useAppStore(s => s.demoScenario);
  const repoName = useAppStore(s => s.repoName);

  const latest = packets[packets.length - 1];
  const scenarioLabel =
    scenario === 'motor' ? 'Motor bring-up'
    : scenario === 'i2c_nack' ? 'I2C sensor NACK'
    : scenario === 'driver_fault' ? 'Motor driver fault'
    : scenario === 'noisy' ? 'Noisy signal'
    : scenario === 'pid' ? 'PID instability'
    : 'PWM timing mismatch';
  const ch1Label = scenario === 'noisy' ? 'CH1 noisy phase'
    : scenario === 'driver_fault' ? 'CH1 clipped phase'
    : scenario === 'pid' ? 'CH1 oscillating speed'
    : 'CH1 motor phase';
  const ch2Label = scenario === 'pwm' ? 'CH2 wrong PWM'
    : 'CH2 control';

  return (
    <div className={styles.strip}>
      <span className={styles.item}><Activity size={14} /> {ch1Label} · {fmtHz(frame?.oscilloscope.ch1?.frequency)}</span>
      <span className={styles.item}><Zap size={14} /> {ch2Label} · {fmtHz(frame?.oscilloscope.ch2?.frequency)}</span>
      <span className={styles.item}><RadioTower size={14} /> {latest ? `${latest.protocol} ${latest.direction} ${latest.address ?? 'bus'}` : 'Listening to mock motor controller bus'}</span>
      <span className={styles.item}><Code2 size={14} /> {repoName || 'firmware context ready'}</span>
      <span className={styles.scenario}>{scenarioLabel}</span>
    </div>
  );
}
