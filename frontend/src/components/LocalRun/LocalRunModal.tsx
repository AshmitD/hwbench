import { Check, Copy, X } from 'lucide-react';
import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import styles from './LocalRunModal.module.css';

const COMMANDS = `npm install
npm run dev:backend
npm run dev:frontend`;

export default function LocalRunModal() {
  const open = useAppStore(s => s.localRunOpen);
  const setLocalRunOpen = useAppStore(s => s.setLocalRunOpen);
  const [copied, setCopied] = useState(false);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);

  if (!open) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(COMMANDS);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.backdrop} onClick={() => setLocalRunOpen(false)} />
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Run HWBench locally">
        <button className={styles.closeBtn} onClick={() => setLocalRunOpen(false)} aria-label="Close local setup">
          <X size={16} />
        </button>
        <span className={styles.kicker}>Local setup</span>
        <h2>Run HWBench locally</h2>
        <p>
          This demo uses mock bench data. To run HWBench from your own checkout, start the backend and frontend.
          The browser cannot start those servers for you.
        </p>
        {isLocal && <div className={styles.localBadge}>You are already running locally.</div>}
        <pre><code>{COMMANDS}</code></pre>
        <button className={styles.copyBtn} onClick={copy}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? 'Copied' : 'Copy commands'}
        </button>
        <div className={styles.notes}>
          <span>Frontend: port 3000</span>
          <span>Backend: port 5001</span>
          <span>Mock hardware stream starts from the backend.</span>
          <span>Claude requires <code>backend/.env</code>. Do not expose API keys.</span>
        </div>
      </section>
    </div>
  );
}
