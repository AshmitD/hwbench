import { ReactNode } from 'react';
import { useAppStore } from '../../store/appStore';
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
        {activePanel ? (
          <>
            <button className={styles.backBtn} onClick={() => set({ activePanel: null })}>
              ← Back
            </button>
            <div className={styles.divider} />
            <span className={styles.panelName}>{PANEL_NAMES[activePanel]}</span>
          </>
        ) : (
          <div className={styles.brand}>
            <span className={styles.brandName}>HWBench</span>
          </div>
        )}

        <div className={styles.status}>
          {hardwareFrame?.mode === 'mock' && <span className={styles.mockBadge}>MOCK</span>}
          <div className={`${styles.statusDot} ${statusDotClass}`} />
          {statusLabel}
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.panelView} key={activePanel ?? 'dashboard'}>
          {children}
        </div>
      </div>
    </div>
  );
}
