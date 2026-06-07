import { DemoScenario, Packet } from '../store/appStore';

interface OfflineDebugInput {
  scenario: DemoScenario;
  packets: Packet[];
  note?: string;
  ch1Frequency?: number;
  ch2Frequency?: number;
  ch1Vpp?: number;
  ch2Vpp?: number;
}

export function isHostedDemo(): boolean {
  const host = window.location.hostname;
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
}

export function buildOfflineDebugResponse(input: OfflineDebugInput): string {
  const recent = input.packets.slice(-12);
  const hasNack = recent.some(p => p.ack === false || p.decoded?.toLowerCase().includes('nack'));
  const hasDriverFault = recent.some(p => p.decoded?.includes('DRV8305 FAULT'));
  const hasPidInstability = recent.some(p => p.decoded?.toLowerCase().includes('unstable'));
  const hasPwmWarning = recent.some(p => p.decoded?.toLowerCase().includes('commanded_pwm'));

  if (input.scenario === 'i2c_nack' || hasNack) {
    return `### Finding
I2C sensor communication is failing intermittently at MPU6050 address 0x68.

### Why I think this
- Recent I2C reads show NACK/timeout responses at register 0x3B.
- Scope measurements look otherwise active, so the failure is concentrated on the sensor bus.

### Where to look
- SDA/SCL wiring and pull-ups
- MPU6050 power and address strap 0x68/0x69
- Firmware retry/timeout handling

### Next check / fix
- Scope SDA/SCL rise time and idle levels.
- Verify pull-up values and sensor power at the connector.`;
  }

  if (input.scenario === 'driver_fault' || hasDriverFault) {
    return `### Finding
Motor driver fault is likely active on the DRV8305 gate driver.

### Why I think this
- SPI traffic includes DRV8305 FAULT register reads with UVLO/OCP warning bits.
- CH1 phase signal is clipped/unstable compared with the healthy motor scenario.

### Where to look
- DRV8305 fault register 0x0A
- Gate enable pins, VM supply, and current limit path

### Next check / fix
- Read and clear the DRV8305 fault register.
- Verify VM rail under load and confirm gate driver enable timing.`;
  }

  if (input.scenario === 'noisy') {
    return `### Finding
Signal integrity or grounding noise is likely affecting the phase measurement.

### Why I think this
- CH1 Vpp/frequency are jittering instead of staying near the healthy 1 kHz phase trace.
- UART reports high ADC phase RMS jitter.

### Where to look
- Probe ground lead and reference point
- Motor supply decoupling and phase current path

### Next check / fix
- Use a short ground spring and re-measure CH1.
- Check supply ripple near the driver during switching.`;
  }

  if (input.scenario === 'pid' || hasPidInstability) {
    return `### Finding
Control loop instability is likely in the PID path.

### Why I think this
- UART logs show unstable PID error/output and saturation.
- CH1 frequency behavior is oscillatory while protocol traffic remains normal.

### Where to look
- PID gains, loop sample time, and actuator saturation limits
- Firmware motor-control update path

### Next check / fix
- Reduce Kp/Ki and log error over time.
- Verify the control loop runs at the expected period.`;
  }

  if (input.scenario === 'pwm' || hasPwmWarning) {
    return `### Finding
PWM timer configuration does not match the commanded output.

### Why I think this
- CH2 measures near ${input.ch2Frequency?.toFixed(0) ?? '147'} Hz instead of the commanded PWM rate.
- UART reports commanded PWM differs from measured PWM and duty.

### Where to look
- Timer prescaler, ARR/CCR values, PWM mode, and clock source

### Next check / fix
- Verify timer clock and prescaler math.
- Compare firmware PWM command with measured CH2 duty/frequency.`;
  }

  return `### Finding
No clear fault detected.

### Why I think this
- CH1 is near ${input.ch1Frequency?.toFixed(0) ?? '1000'} Hz with expected motor-phase amplitude.
- CH2 control waveform is active and protocol traffic does not show fault packets.

### Where to look
- If there is a real symptom, start with the related signal or packet row.

### Next check / fix
- Add a symptom note, then run DEBUG again for a more targeted check.`;
}
