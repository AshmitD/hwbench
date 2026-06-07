import { DemoScenario, HardwareFrame, Packet } from '../store/appStore';

const SAMPLE_COUNT = 1000;
const TIME_WINDOW_MS = 5;

let phase = 0;
let packetSeq = 0;
let tick = 0;
let imuAx = 0.12;
let imuAy = -0.03;
let imuAz = 0.98;
let pidErr = -0.02;

function uid(): string {
  return `browser-pkt-${Date.now()}-${packetSeq++}`;
}

function nowStr(): string {
  return new Date().toISOString().slice(11, 23);
}

function hex(n: number): string {
  return '0x' + n.toString(16).toUpperCase().padStart(2, '0');
}

function bytesToHex(bytes: number[]): string[] {
  return bytes.map(hex);
}

function channel(samples: number[], frequency: number, voltPerDiv: number) {
  const vmin = Math.min(...samples);
  const vmax = Math.max(...samples);
  return {
    samples,
    frequency,
    vpp: vmax - vmin,
    vmin,
    vmax,
    period: (1 / frequency) * 1000,
    voltPerDiv,
    timePerDiv: 0.5,
  };
}

function sine(freq: number, amp: number, noise = 0.035, jitter = 0): number[] {
  return Array.from({ length: SAMPLE_COUNT }, (_, i) => {
    const t = (i / SAMPLE_COUNT) * (TIME_WINDOW_MS / 1000);
    const jt = jitter ? Math.sin(i * 0.043 + phase) * jitter : 0;
    return amp * Math.sin(2 * Math.PI * (freq + jt) * t + phase) + (Math.random() - 0.5) * noise;
  });
}

function square(freq: number, high: number, duty = 0.5, noise = 0.015): number[] {
  return Array.from({ length: SAMPLE_COUNT }, (_, i) => {
    const t = (i / SAMPLE_COUNT) * (TIME_WINDOW_MS / 1000);
    const cycle = ((2 * Math.PI * freq * t + phase * (freq / 1000)) % (2 * Math.PI)) / (2 * Math.PI);
    return (cycle < duty ? high : 0) + (Math.random() - 0.5) * noise;
  });
}

function i2cPacket(scenario: DemoScenario): Packet {
  const nack = scenario === 'i2c_nack' && Math.random() < 0.6;
  imuAx += (Math.random() - 0.5) * 0.01;
  imuAy += (Math.random() - 0.5) * 0.01;
  imuAz = 0.98 + (Math.random() - 0.5) * 0.006;

  if (nack) {
    return {
      id: uid(),
      timestamp: nowStr(),
      protocol: 'I2C',
      direction: 'READ',
      address: '0x68',
      register: '0x3B',
      data: [],
      decoded: 'MPU6050 ACCEL read NACK / timeout',
      ack: false,
    };
  }

  const rawX = Math.round(imuAx * 16384);
  const rawY = Math.round(imuAy * 16384);
  const rawZ = Math.round(imuAz * 16384);
  return {
    id: uid(),
    timestamp: nowStr(),
    protocol: 'I2C',
    direction: 'READ',
    address: '0x68',
    register: '0x3B',
    data: bytesToHex([(rawX >> 8) & 0xff, rawX & 0xff, (rawY >> 8) & 0xff, rawY & 0xff, (rawZ >> 8) & 0xff, rawZ & 0xff]),
    decoded: `MPU6050 ACCEL ax=${imuAx.toFixed(3)}g ay=${imuAy.toFixed(3)}g az=${imuAz.toFixed(3)}g`,
    ack: true,
  };
}

function spiPacket(scenario: DemoScenario): Packet {
  if (scenario === 'driver_fault' && Math.random() < 0.75) {
    return {
      id: uid(),
      timestamp: nowStr(),
      protocol: 'SPI',
      direction: 'READ',
      address: 'CS0',
      register: '0x0A',
      data: bytesToHex([0x84, 0x21]),
      decoded: 'DRV8305 FAULT reg=0x0A GATE_UVLO | OCP_WARN',
    };
  }
  const reg = Math.random() > 0.5 ? 0x01 : 0x02;
  const val = Math.round(Math.random() * 255);
  return {
    id: uid(),
    timestamp: nowStr(),
    protocol: 'SPI',
    direction: 'WRITE',
    address: 'CS0',
    register: hex(reg),
    data: bytesToHex([val]),
    decoded: `DRV8305 REG${hex(reg)}=${hex(val)} gate drv`,
  };
}

function uartPacket(scenario: DemoScenario): Packet {
  pidErr += (Math.random() - 0.5) * (scenario === 'pid' ? 0.09 : 0.005);
  pidErr = Math.max(-0.9, Math.min(0.9, pidErr));

  const messages = [
    `PID: err=${pidErr.toFixed(4)} out=${(pidErr * 2.5).toFixed(4)}`,
    'MOTOR: L=1204 R=1189 rpm',
  ];
  if (scenario === 'i2c_nack') messages.unshift('WARN: imu_timeout=1 accel sample stale');
  if (scenario === 'driver_fault') messages.unshift('FAULT: gate_driver DRV8305 uvlo/ocp warning');
  if (scenario === 'noisy') messages.unshift('WARN: adc_phase_rms jitter high, check ground reference');
  if (scenario === 'pid') messages.unshift(`PID: unstable err=${pidErr.toFixed(3)} out=${(pidErr * 3.8).toFixed(3)} sat=${Math.abs(pidErr) > 0.55 ? 1 : 0}`);
  if (scenario === 'pwm') messages.unshift('WARN: commanded_pwm=20.0kHz measured_pwm=14.7kHz duty target=50% measured=36%');

  return { id: uid(), timestamp: nowStr(), protocol: 'UART', direction: 'RX', data: [], decoded: messages[Math.floor(Math.random() * messages.length)] };
}

export function generateBrowserMockFrame(scenario: DemoScenario): HardwareFrame & { protocol: { newPackets: Packet[] } } {
  phase += 0.314;
  tick += 1;

  const ch1Samples =
    scenario === 'driver_fault' ? sine(1000, 1.9, 0.09).map(v => Math.max(-1.15, Math.min(1.45, v)))
    : scenario === 'noisy' ? sine(1000, 1.65, 0.42, 85)
    : scenario === 'pid' ? sine(820 + Math.sin(phase) * 110, 1.65, 0.06)
    : sine(1000, 1.65, 0.035);

  const ch2Samples = scenario === 'pwm' ? square(147, 5, 0.36, 0.02) : square(250, 5, 0.5);
  const newPackets: Packet[] = [];
  if (tick % 3 === 0) newPackets.push(i2cPacket(scenario));
  if (tick % 5 === 0) newPackets.push(spiPacket(scenario));
  if (tick % 8 === 0) newPackets.push(uartPacket(scenario));

  const ch1Frequency = scenario === 'pid' ? 820 : scenario === 'noisy' ? 1000 + Math.round((Math.random() - 0.5) * 55) : 1000;
  const ch2Frequency = scenario === 'pwm' ? 147 : 250;

  return {
    timestamp: Date.now(),
    mode: 'mock',
    scenario,
    oscilloscope: {
      ch1: channel(ch1Samples, ch1Frequency, 0.5),
      ch2: channel(ch2Samples, ch2Frequency, 1),
    },
    protocol: { newPackets },
  };
}
