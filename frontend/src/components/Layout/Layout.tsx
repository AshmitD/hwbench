import { ReactNode } from 'react';
import { Bot, Cpu, Info, TerminalSquare } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import BenchSnapshotStrip from '../Demo/BenchSnapshotStrip';
import ScenarioSelector from '../Demo/ScenarioSelector';
import styles from './Layout.module.css';

const PANEL_NAMES: Record<string, string> = {
  osc: 'Oscilloscope',
  proto: 'Protocol Decoder',
  funcgen: 'Function Generator',
  code: 'Code Context',
};

interface Props { children: ReactNode; }

export default function Layout({ children }: Props) {
  const connectionStatus = useAppStore(s => s.connectionStatus);
  const hardwareFrame = useAppStore(s => s.hardwareFrame);
  const activePanel = useAppStore(s => s.activePanel);
  const set = useAppStore(s => s.set);
  const setLearnMoreOpen = useAppStore(s => s.setLearnMoreOpen);
  const setLocalRunOpen = useAppStore(s => s.setLocalRunOpen);
  const setDebugOverlayOpen = useAppStore(s => s.setDebugOverlayOpen);

  const statusDotClass =
    connectionStatus === 'disconnected' ? styles.disconnected
    : hardwareFrame?.mode === 'mock' ? styles.mock
    : styles.connected;

  const statusLabel =
    connectionStatus === 'connected'
      ? hardwareFrame?.mode === 'mock' ? 'MOCK · 20fps' : 'LIVE · 20fps'
      : connectionStatus === 'connecting' ? 'CONNECTING…' : 'DISCONNECTED';

  return (
    <div className={styles.root}>
      <div className={styles.topbar}>
        <div className={styles.leftCluster}>
          <div className={styles.brand}>
            <Cpu size={17} />
            <span className={styles.brandName}>HWBench</span>
            <span className={styles.productPill}>Mock robotics bench live</span>
          </div>
          {activePanel && (
            <>
              <div className={styles.divider} />
              <button className={styles.backBtn} onClick={() => set({ activePanel: null })}>
                ← Bench
              </button>
              <span className={styles.panelName}>{PANEL_NAMES[activePanel]}</span>
            </>
          )}
        </div>

        <ScenarioSelector />

        <div className={styles.status}>
          {hardwareFrame?.mode === 'mock' && <span className={styles.mockBadge}>MOCK</span>}
          <div className={`${styles.statusDot} ${statusDotClass}`} />
          {statusLabel}
        </div>

        <div className={styles.actions}>
          <button onClick={() => setLearnMoreOpen(true)} title="Learn what this bench is showing">
            <Info size={14} /> Learn More
          </button>
          <button onClick={() => setLocalRunOpen(true)} title="Run HWBench locally">
            <TerminalSquare size={14} /> Run Locally
          </button>
          <button className={styles.debugBtn} onClick={() => setDebugOverlayOpen(true)} title="Open AI Debug">
            <Bot size={14} /> Open Debug
          </button>
        </div>
      </div>

      <BenchSnapshotStrip />

      <div className={styles.content}>
        <div className={styles.panelView} key={activePanel ?? 'dashboard'}>
          {children}
        </div>
      </div>
    </div>
  );
}
