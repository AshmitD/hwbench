export type MockScenario = 'motor' | 'i2c_nack' | 'driver_fault' | 'noisy' | 'pid' | 'pwm';

export interface ChannelData {
  samples: number[];
  frequency: number;
  vpp: number;
  vmin: number;
  vmax: number;
  period: number;
  voltPerDiv: number;
  timePerDiv: number;
}

export interface Packet {
  id: string;
  timestamp: string;
  protocol: 'I2C' | 'SPI' | 'UART';
  direction: 'READ' | 'WRITE' | 'TX' | 'RX';
  address?: string;
  register?: string;
  data: string[];
  decoded?: string;
  ack?: boolean;
}

export interface HardwareFrame {
  type: 'hardware_update';
  timestamp: number;
  mode: 'mock' | 'live';
  scenario: MockScenario;
  oscilloscope: {
    ch1: ChannelData;
    ch2: ChannelData;
  };
  protocol: {
    newPackets: Packet[];
  };
}

const SAMPLE_COUNT = 1000;
const TIME_WINDOW_MS = 5;

let phase = 0;
let packetSeq = 0;
let lastI2C = 0;
let lastUART = 0;
let lastSPI = 0;
let imuAx = 0.12, imuAy = -0.03, imuAz = 0.98;
let motorL = 1200, motorR = 1185, pidErr = -0.02;

function uid(): string {
  return `pkt-${Date.now()}-${packetSeq++}`;
}

function nowStr(): string {
  return new Date().toISOString().slice(11, 23);
}

function hex(n: number): string {
  return '0x' + n.toString(16).toUpperCase().padStart(2, '0');
}

function bytesToHex(bytes: number[]): string[] {
  return bytes.map((b) => hex(b));
}

function stats(samples: number[], frequency: number, voltPerDiv: number): ChannelData {
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
    const base = cycle < duty ? high : 0;
    const edgeDistance = Math.min(cycle % duty, Math.abs(duty - cycle)) / Math.max(duty, 0.001);
    const ringing = edgeDistance < 0.02 ? Math.sin(cycle * 520) * 0.08 : 0;
    return base + ringing + (Math.random() - 0.5) * noise;
  });
}

function i2cPacket(scenario: MockScenario): Packet {
  const nack = scenario === 'i2c_nack' && Math.random() < 0.55;
  const stale = scenario === 'i2c_nack' && Math.random() < 0.35;
  imuAx += (Math.random() - 0.5) * 0.01;
  imuAy += (Math.random() - 0.5) * 0.01;
  imuAz = 0.98 + (Math.random() - 0.5) * 0.006;

  if (nack) {
    return {
      id: uid(), timestamp: nowStr(), protocol: 'I2C', direction: 'READ',
      address: '0x68', register: '0x3B', data: [],
      decoded: 'MPU6050 ACCEL read NACK / timeout', ack: false,
    };
  }

  const ax = stale ? 0 : imuAx;
  const rawX = Math.round(ax * 16384);
  const rawY = Math.round(imuAy * 16384);
  const rawZ = Math.round(imuAz * 16384);
  return {
    id: uid(), timestamp: nowStr(), protocol: 'I2C', direction: 'READ',
    address: '0x68', register: '0x3B',
    data: bytesToHex([(rawX >> 8) & 0xff, rawX & 0xff, (rawY >> 8) & 0xff, rawY & 0xff, (rawZ >> 8) & 0xff, rawZ & 0xff]),
    decoded: stale ? 'MPU6050 ACCEL stale sample ax=0.000g' : `MPU6050 ACCEL ax=${imuAx.toFixed(3)}g ay=${imuAy.toFixed(3)}g az=${imuAz.toFixed(3)}g`,
    ack: true,
  };
}

function spiPacket(scenario: MockScenario): Packet {
  if (scenario === 'driver_fault' && Math.random() < 0.7) {
    return {
      id: uid(), timestamp: nowStr(), protocol: 'SPI', direction: 'READ',
      address: 'CS0', register: '0x0A', data: bytesToHex([0x84, 0x21]),
      decoded: 'DRV8305 FAULT reg=0x0A GATE_UVLO | OCP_WARN',
    };
  }
  const reg = Math.random() > 0.5 ? 0x01 : 0x02;
  const val = Math.round(Math.random() * 255);
  return {
    id: uid(), timestamp: nowStr(), protocol: 'SPI', direction: 'WRITE',
    address: 'CS0', register: hex(reg), data: bytesToHex([val]),
    decoded: `DRV8305 REG${hex(reg)}=${hex(val)} gate drv`,
  };
}

function uartPacket(scenario: MockScenario): Packet {
  motorL += Math.round((Math.random() - 0.5) * (scenario === 'pid' ? 115 : 20));
  motorR += Math.round((Math.random() - 0.5) * (scenario === 'pid' ? 105 : 20));
  motorL = Math.max(860, Math.min(1580, motorL));
  motorR = Math.max(860, Math.min(1580, motorR));
  pidErr += (Math.random() - 0.5) * (scenario === 'pid' ? 0.09 : 0.005);
  pidErr = Math.max(-0.9, Math.min(0.9, pidErr));

  const messages: string[] = [];
  if (scenario === 'i2c_nack') messages.push('WARN: imu_timeout=1 accel sample stale');
  if (scenario === 'driver_fault') messages.push('FAULT: gate_driver DRV8305 uvlo/ocp warning');
  if (scenario === 'noisy') messages.push('WARN: adc_phase_rms jitter high, check ground reference');
  if (scenario === 'pid') messages.push(`PID: unstable err=${pidErr.toFixed(3)} out=${(pidErr * 3.8).toFixed(3)} sat=${Math.abs(pidErr) > 0.55 ? 1 : 0}`);
  if (scenario === 'pwm') messages.push('WARN: commanded_pwm=20.0kHz measured_pwm=14.7kHz duty target=50% measured=36%');
  messages.push(`MOTOR: L=${motorL} R=${motorR} rpm`, `PID: err=${pidErr.toFixed(4)} out=${(pidErr * 2.5).toFixed(4)}`);

  return { id: uid(), timestamp: nowStr(), protocol: 'UART', direction: 'RX', data: [], decoded: messages[Math.floor(Math.random() * messages.length)] };
}

function scenarioChannels(scenario: MockScenario): { ch1: ChannelData; ch2: ChannelData } {
  if (scenario === 'driver_fault') {
    const clipped = sine(1000, 1.9, 0.09).map(v => Math.max(-1.15, Math.min(1.45, v)));
    return { ch1: stats(clipped, 1000, 0.5), ch2: stats(square(250, 5, 0.5), 250, 1) };
  }
  if (scenario === 'noisy') {
    return { ch1: stats(sine(1000, 1.65, 0.42, 85), 1000 + Math.round((Math.random() - 0.5) * 55), 0.5), ch2: stats(square(250, 5, 0.5, 0.08), 250, 1) };
  }
  if (scenario === 'pid') {
    return { ch1: stats(sine(820 + Math.sin(phase) * 110, 1.65, 0.06), 820, 0.5), ch2: stats(square(250, 5, 0.5), 250, 1) };
  }
  if (scenario === 'pwm') {
    return { ch1: stats(sine(1000, 1.65, 0.04), 1000, 0.5), ch2: stats(square(147, 5, 0.36, 0.02), 147, 1) };
  }
  return { ch1: stats(sine(1000, 1.65, 0.035), 1000, 0.5), ch2: stats(square(250, 5, 0.5), 250, 1) };
}

export function generateFrame(scenario: MockScenario = 'motor'): HardwareFrame {
  const now = Date.now();
  phase += 0.314;

  const newPackets: Packet[] = [];
  if (now - lastI2C > 150) { newPackets.push(i2cPacket(scenario)); lastI2C = now; }
  if (now - lastSPI > 250) { newPackets.push(spiPacket(scenario)); lastSPI = now; }
  if (now - lastUART > 400) { newPackets.push(uartPacket(scenario)); lastUART = now; }

  return {
    type: 'hardware_update',
    timestamp: now,
    mode: 'mock',
    scenario,
    oscilloscope: scenarioChannels(scenario),
    protocol: { newPackets },
  };
}
