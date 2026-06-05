import { ReactNode, useEffect } from 'react';
import { useAppStore } from '../../store/appStore';
import styles from './Layout.module.css';

interface Props {
  left: ReactNode;
  center: ReactNode;
}

export default function Layout({ left, center }: Props) {
  const connectionStatus = useAppStore(s => s.connectionStatus);
  const hardwareFrame = useAppStore(s => s.hardwareFrame);
  const darkMode = useAppStore(s => s.darkMode);
  const set = useAppStore(s => s.set);

  // Apply theme class to html element
  useEffect(() => {
    document.documentElement.classList.toggle('light', !darkMode);
  }, [darkMode]);

  // Load persisted theme on mount
  useEffect(() => {
    const saved = localStorage.getItem('hwbench-theme');
    if (saved === 'light') set({ darkMode: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleTheme = () => {
    const next = !darkMode;
    set({ darkMode: next });
    localStorage.setItem('hwbench-theme', next ? 'dark' : 'light');
  };

  const statusLabel =
    connectionStatus === 'connected'
      ? hardwareFrame?.mode === 'mock' ? 'MOCK · 20fps' : 'LIVE · 20fps'
      : connectionStatus === 'connecting' ? 'CONNECTING' : 'DISCONNECTED';

  const dotClass =
    connectionStatus === 'disconnected' ? styles.disconnected
    : hardwareFrame?.mode === 'mock' ? styles.mock
    : styles.connected;

  return (
    <div className={styles.root}>
      <div className={styles.topbar}>
        <div className={styles.brand}>
          <div className={styles.brandDot} />
          <span className={styles.brandName}>HWBench</span>
          <span className={styles.brandSub}>AI Hardware Debugger</span>
        </div>
        <div className={styles.topbarRight}>
          <div className={styles.status}>
            <div className={`${styles.statusDot} ${dotClass}`} />
            {statusLabel}
          </div>
          <button className={styles.themeToggle} onClick={toggleTheme} title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
            {darkMode ? '☀' : '◑'}
          </button>
        </div>
      </div>
      <div className={styles.panels}>
        <div className={styles.left}>{left}</div>
        <div className={styles.center}>{center}</div>
      </div>
    </div>
  );
}
