import { DemoScenario, useAppStore } from '../../store/appStore';
import styles from './ScenarioSelector.module.css';

const SCENARIOS: Array<{ id: DemoScenario; label: string; hint: string }> = [
  { id: 'motor', label: 'Motor bring-up', hint: 'healthy phase + DRV writes' },
  { id: 'i2c_nack', label: 'I2C sensor NACK', hint: 'MPU6050 intermittent NACK' },
  { id: 'driver_fault', label: 'Motor driver fault', hint: 'DRV8305 fault register' },
  { id: 'noisy', label: 'Noisy signal', hint: 'jitter + unstable Vpp' },
  { id: 'pid', label: 'PID instability', hint: 'UART oscillation logs' },
  { id: 'pwm', label: 'PWM timing mismatch', hint: 'duty/frequency off target' },
];

export default function ScenarioSelector() {
  const scenario = useAppStore(s => s.demoScenario);
  const setDemoScenario = useAppStore(s => s.setDemoScenario);

  return (
    <label className={styles.wrap}>
      <span>Scenario</span>
      <select value={scenario} onChange={e => setDemoScenario(e.target.value as DemoScenario)}>
        {SCENARIOS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      <em>{SCENARIOS.find(item => item.id === scenario)?.hint}</em>
    </label>
  );
}
