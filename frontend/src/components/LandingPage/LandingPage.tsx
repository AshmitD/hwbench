import { useState } from 'react';
import { useProjectStore, type ToolId, type Project } from '../../store/projectStore';
import styles from './LandingPage.module.css';

const ALL_TOOLS: { id: ToolId; label: string; desc: string }[] = [
  { id: 'oscilloscope',     label: 'Oscilloscope',        desc: 'Capture & analyze waveforms' },
  { id: 'logic-analyzer',   label: 'Logic Analyzer',      desc: '8CH digital capture via FX2' },
  { id: 'protocol',         label: 'Protocol Analyzer',   desc: 'I2C / SPI / UART decode' },
  { id: 'funcgen',          label: 'Function Generator',  desc: 'Generate test signals' },
  { id: 'schematic',        label: 'Schematic Viewer',    desc: 'Upload & cross-reference KiCad' },
  { id: 'measurements',     label: 'Measurements',        desc: 'Freq, Vpp, period, stats' },
  { id: 'ai',               label: 'AI Assistant',        desc: 'Context-aware debug help' },
];

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function LandingPage() {
  const ps = useProjectStore();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tools, setTools] = useState<ToolId[]>(['oscilloscope', 'ai']);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const toggleTool = (id: ToolId) =>
    setTools(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);

  const handleCreate = () => {
    if (!name.trim()) return;
    ps.createProject(name.trim(), description.trim(), tools);
    setCreating(false);
    setName(''); setDescription(''); setTools(['oscilloscope', 'ai']);
  };

  const handleDelete = (id: string) => {
    if (deleteConfirm === id) {
      ps.deleteProject(id);
      setDeleteConfirm(null);
    } else {
      setDeleteConfirm(id);
    }
  };

  const ProjectCard = ({ project }: { project: Project }) => (
    <div className={styles.card}>
      <div className={styles.cardBody}>
        <div className={styles.cardName}>{project.name}</div>
        {project.description && (
          <div className={styles.cardDesc}>{project.description}</div>
        )}
        <div className={styles.cardTools}>
          {project.tools.map(t => (
            <span key={t} className={styles.toolChip}>
              {ALL_TOOLS.find(x => x.id === t)?.label ?? t}
            </span>
          ))}
        </div>
        <div className={styles.cardDate}>Created {formatDate(project.createdAt)}</div>
      </div>
      <div className={styles.cardActions}>
        <button className={styles.openBtn} onClick={() => ps.openProject(project.id)}>
          Open
        </button>
        <button
          className={`${styles.deleteBtn} ${deleteConfirm === project.id ? styles.deleteBtnConfirm : ''}`}
          onClick={() => handleDelete(project.id)}
          title={deleteConfirm === project.id ? 'Click again to confirm delete' : 'Delete project'}>
          {deleteConfirm === project.id ? 'Confirm?' : '✕'}
        </button>
      </div>
    </div>
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.logo}>
          <span className={styles.logoMark}>⌬</span>
          <span className={styles.logoName}>HWBench</span>
        </div>
        <p className={styles.tagline}>Hardware debug workbench</p>
      </div>

      <div className={styles.content}>
        {creating ? (
          <div className={styles.wizard}>
            <h2 className={styles.wizardTitle}>New Project</h2>

            <label className={styles.fieldLabel}>Project name</label>
            <input
              className={styles.input}
              placeholder="e.g. Motor driver debug"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false); }}
            />

            <label className={styles.fieldLabel}>Description (optional)</label>
            <textarea
              className={styles.textarea}
              placeholder="What are you debugging? Briefly describe the circuit or issue."
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
            />

            <label className={styles.fieldLabel}>Tools</label>
            <div className={styles.toolGrid}>
              {ALL_TOOLS.map(tool => (
                <button
                  key={tool.id}
                  className={`${styles.toolCard} ${tools.includes(tool.id) ? styles.toolCardOn : ''}`}
                  onClick={() => toggleTool(tool.id)}>
                  <div className={styles.toolCardLabel}>{tool.label}</div>
                  <div className={styles.toolCardDesc}>{tool.desc}</div>
                </button>
              ))}
            </div>

            <div className={styles.wizardActions}>
              <button className={styles.cancelBtn} onClick={() => setCreating(false)}>Cancel</button>
              <button
                className={styles.createBtn}
                onClick={handleCreate}
                disabled={!name.trim() || tools.length === 0}>
                Create Project
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Projects</h2>
              <button className={styles.newBtn} onClick={() => setCreating(true)}>+ New Project</button>
            </div>

            {ps.projects.length === 0 ? (
              <div className={styles.empty}>
                <div className={styles.emptyIcon}>⌬</div>
                <div className={styles.emptyText}>No projects yet</div>
                <div className={styles.emptyHint}>Create a project to start debugging</div>
                <button className={styles.newBtn} onClick={() => setCreating(true)}>+ New Project</button>
              </div>
            ) : (
              <div className={styles.cardList}>
                {[...ps.projects].reverse().map(p => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
