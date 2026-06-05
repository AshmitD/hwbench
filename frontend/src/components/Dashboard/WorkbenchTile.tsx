import { ReactNode } from 'react';
import { Maximize2, Minus } from 'lucide-react';
import { TileId } from '../../store/appStore';
import styles from './Dashboard.module.css';

interface Props {
  id: TileId;
  title: string;
  subtitle?: string;
  icon: ReactNode;
  status?: ReactNode;
  children: ReactNode;
  isExpanded?: boolean;
  isDocked?: boolean;
  onExpand: (id: TileId) => void;
  onCollapse?: () => void;
}

export default function WorkbenchTile({
  id,
  title,
  subtitle,
  icon,
  status,
  children,
  isExpanded = false,
  isDocked = false,
  onExpand,
  onCollapse,
}: Props) {
  const handleShellClick = () => {
    if (!isExpanded) onExpand(id);
  };

  return (
    <section
      className={`${styles.tile} ${isExpanded ? styles.expandedTile : ''} ${isDocked ? styles.dockedTile : ''}`}
      onClick={handleShellClick}
      aria-label={`${title} tile`}
    >
      <div className={styles.tileHeader}>
        <div className={styles.tileTitleGroup}>
          <span className={styles.tileIcon}>{icon}</span>
          <div className={styles.tileText}>
            <span className={styles.tileTitle}>{title}</span>
            {subtitle && <span className={styles.tileSubtitle}>{subtitle}</span>}
          </div>
        </div>
        <div className={styles.tileActions}>
          {status}
          {isExpanded ? (
            <button
              className={styles.iconBtn}
              onClick={(e) => { e.stopPropagation(); onCollapse?.(); }}
              title="Collapse tile"
              aria-label="Collapse tile"
            >
              <Minus size={15} />
            </button>
          ) : (
            <button
              className={styles.iconBtn}
              onClick={(e) => { e.stopPropagation(); onExpand(id); }}
              title="Expand tile"
              aria-label="Expand tile"
            >
              <Maximize2 size={14} />
            </button>
          )}
        </div>
      </div>
      <div className={styles.tileBody}>{children}</div>
    </section>
  );
}
