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
const CH1_FREQ = 1000;
const CH2_FREQ = 250;

// Realistic IMU simulation state
let imuAx = 0.12, imuAy = -0.03, imuAz = 0.98;
let motorL = 1200, motorR = 1185;
let encoderL = 0, encoderR = 0;
let pidErr = -0.02;

let phase = 0;
let lastI2C = 0;
let lastUART = 0;
let lastSPI = 0;
let packetSeq = 0;

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

function generateI2CPacket(): Packet {
  // Alternate between accelerometer reads and gyro reads (MPU6050 at 0x68)
  const isRead = Math.random() > 0.3;
  const reg = isRead ? 0x3b : 0x6b; // ACCEL_XOUT_H or PWR_MGMT_1

  // Drift IMU values
  imuAx += (Math.random() - 0.5) * 0.01;
  imuAy += (Math.random() - 0.5) * 0.01;
  imuAz = 0.98 + (Math.random() - 0.5) * 0.005;

  const rawX = Math.round(imuAx * 16384);
  const rawY = Math.round(imuAy * 16384);
  const rawZ = Math.round(imuAz * 16384);

  const data = isRead
    ? bytesToHex([(rawX >> 8) & 0xff, rawX & 0xff, (rawY >> 8) & 0xff, rawY & 0xff, (rawZ >> 8) & 0xff, rawZ & 0xff])
    : bytesToHex([0x00]);

  return {
    id: uid(),
    timestamp: nowStr(),
    protocol: 'I2C',
    direction: isRead ? 'READ' : 'WRITE',
    address: '0x68',
    register: hex(reg),
    data,
    decoded: isRead
      ? `MPU6050 ACCEL ax=${imuAx.toFixed(3)}g ay=${imuAy.toFixed(3)}g az=${imuAz.toFixed(3)}g`
      : `MPU6050 WAKE`,
    ack: true,
  };
}

function generateUARTPacket(): Packet {
  motorL += Math.round((Math.random() - 0.5) * 20);
  motorR += Math.round((Math.random() - 0.5) * 20);
  motorL = Math.max(1100, Math.min(1300, motorL));
  motorR = Math.max(1100, Math.min(1300, motorR));
  encoderL = (encoderL + motorL * 0.001) % 360;
  encoderR = (encoderR + motorR * 0.001) % 360;
  pidErr += (Math.random() - 0.5) * 0.005;
  pidErr = Math.max(-0.1, Math.min(0.1, pidErr));

  const messages = [
    `MOTOR: L=${motorL} R=${motorR} rpm`,
    `IMU: ax=${imuAx.toFixed(3)} ay=${imuAy.toFixed(3)} az=${imuAz.toFixed(3)}`,
    `ENC: L=${encoderL.toFixed(1)} R=${encoderR.toFixed(1)} deg`,
    `PID: err=${pidErr.toFixed(4)} out=${(pidErr * 2.5).toFixed(4)}`,
  ];

  const msg = messages[Math.floor(Math.random() * messages.length)];

  return {
    id: uid(),
    timestamp: nowStr(),
    protocol: 'UART',
    direction: 'RX',
    data: [],
    decoded: msg,
  };
}

function generateSPIPacket(): Packet {
  // SPI motor driver (DRV8305 at CS0) or flash read
  const isMotorDriver = Math.random() > 0.4;

  if (isMotorDriver) {
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
      decoded: `DRV8305 REG${hex(reg)}=${hex(val)} (${isMotorDriver ? 'gate drv' : 'ctrl'})`,
    };
  }

  const addr = Math.round(Math.random() * 0xfff);
  const bytes = Array.from({ length: 4 }, () => Math.round(Math.random() * 255));
  return {
    id: uid(),
    timestamp: nowStr(),
    protocol: 'SPI',
    direction: 'READ',
    address: 'CS1',
    register: hex(addr),
    data: bytesToHex(bytes),
    decoded: `FLASH READ @${hex(addr)}`,
  };
}

export function generateFrame(): HardwareFrame {
  const now = Date.now();
  phase += 0.314; // advance ~18deg per frame at 20fps

  const ch1Samples = Array.from({ length: SAMPLE_COUNT }, (_, i) => {
    const t = (i / SAMPLE_COUNT) * (TIME_WINDOW_MS / 1000);
    const sine = 1.65 * Math.sin(2 * Math.PI * CH1_FREQ * t + phase);
    const noise = (Math.random() - 0.5) * 0.04;
    return sine + noise;
  });

  const ch2Samples = Array.from({ length: SAMPLE_COUNT }, (_, i) => {
    const t = (i / SAMPLE_COUNT) * (TIME_WINDOW_MS / 1000);
    const phaseOffset = phase * (CH2_FREQ / CH1_FREQ);
    const cyclePos = ((2 * Math.PI * CH2_FREQ * t + phaseOffset) % (2 * Math.PI)) / (2 * Math.PI);
    const base = cyclePos < 0.5 ? 5.0 : 0.0;
    // Slight ringing on edges for realism
    const distFromEdge = Math.min(cyclePos % 0.5, 0.5 - (cyclePos % 0.5)) / 0.5;
    const ringing = distFromEdge < 0.02 ? Math.sin(cyclePos * 500) * 0.1 : 0;
    return base + ringing;
  });

  const newPackets: Packet[] = [];
  if (now - lastI2C > 150) { newPackets.push(generateI2CPacket()); lastI2C = now; }
  if (now - lastUART > 400) { newPackets.push(generateUARTPacket()); lastUART = now; }
  if (now - lastSPI > 250) { newPackets.push(generateSPIPacket()); lastSPI = now; }

  return {
    type: 'hardware_update',
    timestamp: now,
    mode: 'mock',
    oscilloscope: {
      ch1: {
        samples: ch1Samples,
        frequency: CH1_FREQ,
        vpp: 3.3,
        vmin: -1.65,
        vmax: 1.65,
        period: (1 / CH1_FREQ) * 1000,
        voltPerDiv: 0.5,
        timePerDiv: 0.5,
      },
      ch2: {
        samples: ch2Samples,
        frequency: CH2_FREQ,
        vpp: 5.0,
        vmin: 0.0,
        vmax: 5.0,
        period: (1 / CH2_FREQ) * 1000,
        voltPerDiv: 1.0,
        timePerDiv: 0.5,
      },
    },
    protocol: { newPackets },
  };
}
