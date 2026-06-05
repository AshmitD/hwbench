import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { TileId, useAppStore } from '../../store/appStore';
import styles from './Dashboard.module.css';

export const TILE_LABELS: Record<TileId, string> = {
  osc: 'Oscilloscope',
  proto: 'Protocol traffic',
  funcgen: 'Func gen + DMM',
  code: 'Code context',
  measurements: 'Measurements',
  ai: 'AI debug',
  cad: 'CAD context',
};

const TILE_ORDER: TileId[] = ['osc', 'proto', 'measurements', 'funcgen', 'code', 'ai', 'cad'];

export default function TilePicker() {
  const [open, setOpen] = useState(false);
  const visibleTiles = useAppStore(s => s.visibleTiles);
  const toggleTile = useAppStore(s => s.toggleTile);

  return (
    <div className={styles.pickerWrap}>
      <button className={styles.pickerBtn} onClick={() => setOpen(o => !o)} title="Customize dashboard tiles">
        <SlidersHorizontal size={15} />
        Tiles
      </button>
      {open && (
        <div className={styles.pickerMenu}>
          {TILE_ORDER.map(tileId => (
            <label key={tileId} className={styles.pickerRow}>
              <input
                type="checkbox"
                checked={visibleTiles[tileId]}
                onChange={() => toggleTile(tileId)}
              />
              <span>{TILE_LABELS[tileId]}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
