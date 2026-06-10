import { useEffect } from 'react';
import { useAppStore } from '../../store/appStore';
import styles from './DeviceToast.module.css';

const AUTO_DISMISS_MS = 10_000;

export default function DeviceToast() {
  const device = useAppStore(s => s.pendingDeviceToast);
  const toggleTile = useAppStore(s => s.toggleTile);
  const setPending = useAppStore(s => s.setPendingDeviceToast);
  const visibleTiles = useAppStore(s => s.visibleTiles);

  useEffect(() => {
    if (!device) return;
    const t = setTimeout(() => setPending(null), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [device, setPending]);

  if (!device) return null;

  const handleOpen = () => {
    if (device.kind === 'fx2-la' && !visibleTiles['la']) {
      toggleTile('la');
    }
    setPending(null);
  };

  const kindLabel = device.kind === 'fx2-la' ? 'Logic Analyzer' : 'Device';

  return (
    <div className={styles.toast} role="alert">
      <div className={styles.dot} />
      <div className={styles.body}>
        <div className={styles.title}>{kindLabel} detected</div>
        <div className={styles.label}>{device.label}</div>
      </div>
      <div className={styles.actions}>
        <button className={styles.openBtn} onClick={handleOpen}>
          Open panel
        </button>
        <button className={styles.dismissBtn} onClick={() => setPending(null)} title="Dismiss">
          ✕
        </button>
      </div>
    </div>
  );
}
