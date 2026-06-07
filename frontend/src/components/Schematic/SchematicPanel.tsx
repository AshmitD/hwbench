import { useState, useRef, DragEvent } from 'react';
import { useAppStore } from '../../store/appStore';
import { parseKicadSchematic } from '../../utils/parseKicad';
import styles from './SchematicPanel.module.css';

interface Props {
  expanded?: boolean;
}

export default function SchematicPanel({ expanded = false }: Props) {
  const schematic = useAppStore(s => s.schematic);
  const setSchematic = useAppStore(s => s.setSchematic);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = (file: File) => {
    if (!file.name.endsWith('.kicad_sch')) {
      setError('Drop a .kicad_sch file');
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = e => {
      const content = e.target?.result as string;
      const parsed = parseKicadSchematic(content, file.name);
      setSchematic(parsed);
    };
    reader.readAsText(file);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) load(file);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) load(file);
    e.target.value = '';
  };

  if (!schematic) {
    return (
      <div
        className={`${styles.dropZone} ${dragging ? styles.dragging : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input ref={fileInputRef} type="file" accept=".kicad_sch" style={{ display: 'none' }} onChange={onFileChange} />
        <span className={styles.dropIcon}>📐</span>
        <span className={styles.dropText}>Drop .kicad_sch file here</span>
        <span className={styles.dropSub}>or click to browse</span>
        {error && <span className={styles.dropError}>{error}</span>}
      </div>
    );
  }

  const { fileName, nets, componentCount } = schematic;

  if (!expanded) {
    return (
      <div className={styles.compactView}>
        <div className={styles.compactFile}>{fileName}</div>
        <div className={styles.compactMeta}>{nets.length} nets · {componentCount} components</div>
        <div className={styles.compactNets}>
          {nets.slice(0, 4).map(net => (
            <div key={net.netName} className={styles.compactNetRow}>
              <span className={styles.compactNetName}>{net.netName}</span>
              <span className={styles.compactNetComps}>
                {net.entries.map(e => `${e.ref} ${e.value}`).slice(0, 3).join(' · ') || '—'}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.expandedView}>
      <div className={styles.expandedHeader}>
        <div>
          <span className={styles.expandedFile}>{fileName}</span>
          <span className={styles.expandedMeta}>{nets.length} nets · {componentCount} components · parsed client-side</span>
        </div>
        <button className={styles.clearBtn} onClick={() => setSchematic(null)}>✕ Clear</button>
      </div>
      <div className={styles.tableHeader}>
        <span>NET</span>
        <span>COMPONENTS</span>
      </div>
      <div className={styles.tableBody}>
        {nets.map(net => (
          <div key={net.netName} className={styles.tableRow}>
            <span className={styles.netName}>{net.netName}</span>
            <span className={styles.netComps}>
              {net.entries.map(e => `${e.ref}(${e.value}).pin${e.pin}`).join(', ') || '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
