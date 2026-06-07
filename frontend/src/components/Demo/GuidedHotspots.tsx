import { X } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import styles from './GuidedHotspots.module.css';

export default function GuidedHotspots() {
  const show = useAppStore(s => s.showGuidedHotspots);
  const dismiss = useAppStore(s => s.dismissGuidedHotspots);
  const setHighlightedTile = useAppStore(s => s.setHighlightedTile);

  if (!show) return null;

  const items = [
    { n: 1, tile: 'osc' as const, label: 'CH1 motor phase signal' },
    { n: 2, tile: 'proto' as const, label: 'I2C/SPI/UART packets' },
    { n: 3, tile: 'ai' as const, label: 'AI reads the bench state' },
  ];

  return (
    <div className={styles.hotspots}>
      <button className={styles.close} onClick={dismiss} title="Dismiss guide" aria-label="Dismiss guided demo">
        <X size={13} />
      </button>
      {items.map(item => (
        <button
          key={item.n}
          className={styles.hotspot}
          onClick={() => {
            setHighlightedTile(item.tile);
            window.setTimeout(() => setHighlightedTile(null), 2400);
          }}
        >
          <span>{item.n}</span>
          {item.label}
        </button>
      ))}
    </div>
  );
}
