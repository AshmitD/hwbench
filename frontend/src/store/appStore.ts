import { create } from 'zustand';

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
  timestamp: number;
  mode: 'mock' | 'live';
  oscilloscope: { ch1: ChannelData; ch2: ChannelData };
}

export interface TreeNode { path: string; type: 'blob' | 'tree'; size?: number; }

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  hidden?: boolean; // auto-triggered system prompts — not shown in chat UI
}

export const VOLT_PER_DIV = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5];
export const TIME_PER_DIV_MS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5]; // ms
// Buffer is 5ms; zoom = 5 / (10 * timeDivMs). Clamped to [1..500]

export function timeDivToZoom(msPerDiv: number): number {
  return Math.max(1, Math.min(500, 5 / (10 * msPerDiv)));
}
export function fmtTimDiv(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
  return `${ms}ms`;
}
export function fmtVDiv(v: number): string {
  if (v < 1) return `${(v * 1000).toFixed(0)}mV`;
  return `${v}V`;
}

interface AppState {
  // Hardware
  hardwareFrame: HardwareFrame | null;
  packets: Packet[];
  connectionStatus: 'connecting' | 'connected' | 'disconnected';

  // Pause
  oscilloscopePaused: boolean;
  protocolPaused: boolean;

  // Scope feature flags
  persistMode: boolean;
  fftMode: boolean;
  showCursors: boolean;
  showMath: boolean;
  mathOperation: 'CH1+CH2' | 'CH1-CH2' | 'CH1×CH2';

  // Channel settings
  ch1Enabled: boolean;
  ch2Enabled: boolean;
  ch1Coupling: 'DC' | 'AC' | 'GND';
  ch2Coupling: 'DC' | 'AC' | 'GND';
  ch1Probe: '1x' | '10x' | '100x';
  ch2Probe: '1x' | '10x' | '100x';
  ch1Invert: boolean;
  ch2Invert: boolean;
  ch1VoltPerDivIdx: number; // index into VOLT_PER_DIV
  ch2VoltPerDivIdx: number;

  // Trigger
  triggerSource: 'CH1' | 'CH2';
  triggerEdge: 'rising' | 'falling';
  triggerMode: 'AUTO' | 'NORM' | 'SINGLE';
  triggerLevel: number;

  // Acquisition
  acqMode: 'NORM' | 'PEAK' | 'AVG';
  acqAvgN: 2 | 4 | 8 | 16 | 32 | 64;

  // Function generator
  funcWaveform: 'sine' | 'square' | 'triangle' | 'sawtooth';
  funcFrequency: number;
  funcFreqUnit: 'Hz' | 'kHz' | 'MHz';
  funcAmplitude: number;
  funcOffset: number;
  funcW1: boolean;
  funcW2: boolean;

  // Multimeter
  meterMode: 'V' | 'A' | 'Ω' | 'CONT';

  // Navigation — which panel is expanded (null = dashboard)
  activePanel: null | 'osc' | 'proto' | 'funcgen' | 'code';

  // Code context
  repoUrl: string;
  repoOwner: string;
  repoName: string;
  repoTree: TreeNode[] | null;
  selectedFile: { path: string; content: string } | null;
  repoLoading: boolean;
  repoError: string | null;

  // AI chat
  messages: ChatMessage[];
  isStreaming: boolean;
  activeHighlight: string | null;

  // Actions
  setHardwareFrame: (frame: HardwareFrame) => void;
  addPackets: (packets: Packet[]) => void;
  setConnectionStatus: (s: 'connecting' | 'connected' | 'disconnected') => void;
  toggleOscilloscopePause: () => void;
  toggleProtocolPause: () => void;
  set: (partial: Partial<AppState>) => void;
  setRepo: (url: string, owner: string, name: string) => void;
  setRepoTree: (tree: TreeNode[] | null) => void;
  setSelectedFile: (file: { path: string; content: string } | null) => void;
  setRepoLoading: (l: boolean) => void;
  setRepoError: (e: string | null) => void;
  clearRepo: () => void;
  addMessage: (m: ChatMessage) => void;
  appendToLastMessage: (text: string) => void;
  setIsStreaming: (s: boolean) => void;
  setActiveHighlight: (h: string | null) => void;
}

const MAX_PACKETS = 300;

export const useAppStore = create<AppState>((setState) => ({
  hardwareFrame: null,
  packets: [],
  connectionStatus: 'connecting',

  oscilloscopePaused: false,
  protocolPaused: false,

  persistMode: false,
  fftMode: false,
  showCursors: false,
  showMath: false,
  mathOperation: 'CH1-CH2',

  ch1Enabled: true,
  ch2Enabled: true,
  ch1Coupling: 'DC',
  ch2Coupling: 'DC',
  ch1Probe: '1x',
  ch2Probe: '1x',
  ch1Invert: false,
  ch2Invert: false,
  ch1VoltPerDivIdx: 9,  // 1V/div
  ch2VoltPerDivIdx: 10, // 2V/div

  triggerSource: 'CH1',
  triggerEdge: 'rising',
  triggerMode: 'AUTO',
  triggerLevel: 0,

  acqMode: 'NORM',
  acqAvgN: 8,

  funcWaveform: 'sine',
  funcFrequency: 1,
  funcFreqUnit: 'kHz',
  funcAmplitude: 3.3,
  funcOffset: 0,
  funcW1: true,
  funcW2: false,

  meterMode: 'V',
  activePanel: null,

  repoUrl: '',
  repoOwner: '',
  repoName: '',
  repoTree: null,
  selectedFile: null,
  repoLoading: false,
  repoError: null,

  messages: [],
  isStreaming: false,
  activeHighlight: null,

  setHardwareFrame: (frame) => setState({ hardwareFrame: frame }),

  addPackets: (newPkts) =>
    setState((state) => {
      const merged = [...state.packets, ...newPkts];
      return { packets: merged.length > MAX_PACKETS ? merged.slice(-MAX_PACKETS) : merged };
    }),

  setConnectionStatus: (s) => setState({ connectionStatus: s }),

  toggleOscilloscopePause: () => setState((s) => ({ oscilloscopePaused: !s.oscilloscopePaused })),
  toggleProtocolPause: () => setState((s) => ({ protocolPaused: !s.protocolPaused })),

  set: (partial) => setState(partial),

  setRepo: (url, owner, name) => setState({ repoUrl: url, repoOwner: owner, repoName: name }),
  setRepoTree: (tree) => setState({ repoTree: tree }),
  setSelectedFile: (file) => setState({ selectedFile: file }),
  setRepoLoading: (l) => setState({ repoLoading: l }),
  setRepoError: (e) => setState({ repoError: e }),
  clearRepo: () => setState({ repoUrl: '', repoOwner: '', repoName: '', repoTree: null, selectedFile: null, repoError: null }),

  addMessage: (m) => setState((s) => ({ messages: [...s.messages, m] })),
  appendToLastMessage: (text) =>
    setState((s) => {
      if (!s.messages.length) return s;
      const msgs = [...s.messages];
      msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: msgs[msgs.length - 1].content + text };
      return { messages: msgs };
    }),
  setIsStreaming: (s) => setState({ isStreaming: s }),
  setActiveHighlight: (h) => setState({ activeHighlight: h }),
}));
