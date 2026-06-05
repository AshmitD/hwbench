import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { useAppStore, ChatMessage, VOLT_PER_DIV } from '../../store/appStore';
import styles from './DebugOverlay.module.css';

// ─── Markdown renderer ────────────────────────────────────────────────────────
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>;
    if (p.startsWith('`') && p.endsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>;
    return p;
  });
}

function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;
  // Split on double newlines for blocks, single newlines for list items
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let codeLines: string[] = [];
  let inCode = false;
  let keyIdx = 0;

  const flushList = () => {
    if (!listItems.length) return;
    elements.push(<ul key={keyIdx++}>{listItems.map((item, i) => <li key={i}>{renderInline(item)}</li>)}</ul>);
    listItems = [];
  };
  const flushCode = () => {
    if (!codeLines.length) return;
    elements.push(<pre key={keyIdx++}><code>{codeLines.join('\n')}</code></pre>);
    codeLines = [];
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) { flushCode(); inCode = false; }
      else { flushList(); inCode = true; }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }

    if (line.startsWith('### ')) { flushList(); elements.push(<h3 key={keyIdx++}>{renderInline(line.slice(4))}</h3>); continue; }
    if (line.startsWith('## ')) { flushList(); elements.push(<h2 key={keyIdx++}>{renderInline(line.slice(3))}</h2>); continue; }
    if (line.startsWith('# ')) { flushList(); elements.push(<h1 key={keyIdx++}>{renderInline(line.slice(2))}</h1>); continue; }
    if (line.startsWith('- ') || line.startsWith('* ')) { listItems.push(line.slice(2)); continue; }
    if (line.match(/^\d+\. /)) { listItems.push(line.replace(/^\d+\. /, '')); continue; }

    if (line.trim() === '') { flushList(); continue; }
    flushList();
    elements.push(<p key={keyIdx++}>{renderInline(line)}</p>);
  }
  flushList(); flushCode();
  return elements;
}

// ─── Context builder (shared with AIPanel) ────────────────────────────────────
function buildContext(s: ReturnType<typeof useAppStore.getState>) {
  const ch1 = s.hardwareFrame?.oscilloscope.ch1;
  const ch2 = s.hardwareFrame?.oscilloscope.ch2;
  const fmtHz = (hz: number) => hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${hz.toFixed(1)} Hz`;
  const fmtV = (v: number) => `${v.toFixed(3)}V`;
  const ch1VPD = VOLT_PER_DIV[s.ch1VoltPerDivIdx];
  const ch2VPD = VOLT_PER_DIV[s.ch2VoltPerDivIdx];

  const protocolLines = s.packets.slice(-20).map(p => {
    if (p.protocol === 'I2C') return `[${p.timestamp}] I2C ${p.direction} addr=${p.address} reg=${p.register} data=[${p.data.join(' ')}]${p.decoded ? ` → ${p.decoded}` : ''}`;
    if (p.protocol === 'SPI') return `[${p.timestamp}] SPI ${p.direction} ${p.address} reg=${p.register}${p.decoded ? ` → ${p.decoded}` : ''}`;
    return `[${p.timestamp}] UART ${p.direction}${p.decoded ? ` "${p.decoded}"` : ''}`;
  });

  let codeCtx: string | null = null;
  if (s.selectedFile) codeCtx = `FILE: ${s.selectedFile.path}\n\`\`\`\n${s.selectedFile.content.slice(0, 5000)}\n\`\`\``;
  else if (s.repoUrl) codeCtx = `REPO: ${s.repoUrl}`;

  return {
    oscilloscope: {
      ch1: ch1 ? { frequency: fmtHz(ch1.frequency), vpp: `${ch1.vpp.toFixed(2)}V`, vmin: fmtV(ch1.vmin), vmax: fmtV(ch1.vmax), coupling: s.ch1Coupling, probe: s.ch1Probe, voltPerDiv: `${ch1VPD < 1 ? ch1VPD * 1000 + 'mV' : ch1VPD + 'V'}` } : undefined,
      ch2: ch2 ? { frequency: fmtHz(ch2.frequency), vpp: `${ch2.vpp.toFixed(2)}V`, vmin: fmtV(ch2.vmin), vmax: fmtV(ch2.vmax), coupling: s.ch2Coupling, probe: s.ch2Probe, voltPerDiv: `${ch2VPD < 1 ? ch2VPD * 1000 + 'mV' : ch2VPD + 'V'}` } : undefined,
    },
    trigger: { source: s.triggerSource, edge: s.triggerEdge, level: `${s.triggerLevel >= 0 ? '+' : ''}${s.triggerLevel.toFixed(2)}V`, mode: s.triggerMode },
    acquisition: { mode: s.acqMode, averages: s.acqMode === 'AVG' ? s.acqAvgN : null },
    protocol_traffic: protocolLines,
    function_generator: { waveform: s.funcWaveform, frequency: `${s.funcFrequency}${s.funcFreqUnit}`, amplitude: `${s.funcAmplitude}Vpp`, w1: s.funcW1, w2: s.funcW2 },
    multimeter: { mode: s.meterMode, reading: 'live' },
    code_context: codeCtx,
    mode: s.hardwareFrame?.mode ?? 'mock',
  };
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function DebugOverlay() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const autoTriggeredRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recogRef = useRef<unknown>(null);

  const s = useAppStore();
  const { messages, isStreaming, addMessage, appendToLastMessage, setIsStreaming } = s;

  const visibleMessages = messages.filter(m => !m.hidden).slice(-8);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Send a message ─────────────────────────────────────────────────────────
  const send = async (text: string, hidden = false) => {
    if (!text.trim() || isStreaming) return;

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text.trim(), timestamp: Date.now(), hidden };
    addMessage(userMsg);
    setInput('');
    setIsStreaming(true);

    const assistantMsg: ChatMessage = { id: `a-${Date.now()}`, role: 'assistant', content: '', timestamp: Date.now() };
    addMessage(assistantMsg);

    try {
      const state = useAppStore.getState();
      const apiMessages = state.messages
        .filter(m => m.content.length > 0)
        .map(m => ({ role: m.role, content: m.content }));
      apiMessages.push({ role: 'user', content: text.trim() });

      const res = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, context: buildContext(state) }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No body');

      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') break;
          try { const p = JSON.parse(payload); if (p.text) appendToLastMessage(p.text); } catch { /* skip */ }
        }
      }
    } catch (e) {
      appendToLastMessage(`\n\n[Error: ${e instanceof Error ? e.message : 'failed'}]`);
    } finally {
      setIsStreaming(false);
    }
  };

  // ── Auto-trigger analysis when panel opens ─────────────────────────────────
  const openPanel = () => {
    setOpen(true);
    if (!autoTriggeredRef.current) {
      autoTriggeredRef.current = true;
      setTimeout(() => send('Analyze current hardware state. Flag anything unusual.', true), 100);
    }
  };

  const closePanel = () => {
    setOpen(false);
    autoTriggeredRef.current = false;
  };

  // ── Voice recording ────────────────────────────────────────────────────────
  const startListening = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec: any = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = Array.from(e.results as any[]).map((r: any) => r[0].transcript).join('');
      if (t.trim()) send(t.trim());
    };
    rec.onend = () => setIsListening(false);
    rec.onerror = () => setIsListening(false);
    rec.start();
    recogRef.current = rec;
    setIsListening(true);
  };

  const stopListening = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (recogRef.current as any)?.stop();
    setIsListening(false);
  };

  // ── Global keyboard shortcuts ──────────────────────────────────────────────
  useEffect(() => {
    const onDown = (e: globalThis.KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.code === 'Escape' && open) { closePanel(); return; }

      if (e.code === 'KeyM' && !e.repeat) {
        e.preventDefault();
        if (!open) openPanel();
        startListening();
      }
    };

    const onUp = (e: globalThis.KeyboardEvent) => {
      if (e.code === 'KeyM') {
        e.preventDefault();
        stopListening();
      }
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isStreaming]);

  const handleInputKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  return (
    <>
      {/* Floating trigger button */}
      {!open && (
        <button className={styles.floatBtn} onClick={openPanel} title="Open AI debug panel (or press M to voice-activate)">
          <span className={styles.floatBtnDot} />
          ⚡ DEBUG
        </button>
      )}

      {/* Overlay + panel */}
      {open && (
        <div className={styles.overlay}>
          <div className={styles.backdrop} onClick={closePanel} />
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div className={styles.panelDot} />
              <span className={styles.panelTitle}>⚡ AI DEBUG</span>
              <button className={styles.closeBtn} onClick={closePanel} title="Close (Esc)">✕</button>
            </div>

            <div className={styles.messages}>
              {visibleMessages.length === 0 && isStreaming && (
                <div className={styles.analyzing}>
                  <div className={styles.spinner} />
                  Analyzing hardware state…
                </div>
              )}
              {visibleMessages.map((msg, i) => {
                const isLast = i === visibleMessages.length - 1;
                const showCursor = isLast && msg.role === 'assistant' && isStreaming;
                if (msg.role === 'user') {
                  return (
                    <div key={msg.id} className={styles.message} style={{ alignItems: 'flex-end' }}>
                      <div className={styles.userBubble}>{msg.content}</div>
                    </div>
                  );
                }
                return (
                  <div key={msg.id} className={styles.message}>
                    <div className={styles.messageMeta}>
                      <span className={styles.roleClaude}>claude</span>
                    </div>
                    <div className={styles.messageBody}>
                      {renderMarkdown(msg.content)}
                      {showCursor && <span className={styles.cursor} />}
                      {isLast && msg.content === '' && isStreaming && <span className={styles.cursor} />}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            <div className={styles.inputArea}>
              <textarea
                ref={inputRef}
                className={styles.input}
                placeholder="Ask follow-up… (or hold M to speak)"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleInputKey}
                disabled={isStreaming}
                rows={1}
              />
              <button className={styles.sendBtn} onClick={() => send(input)} disabled={!input.trim() || isStreaming}>↑</button>
            </div>
          </div>
        </div>
      )}

      {/* LISTENING indicator */}
      {isListening && (
        <div className={styles.listeningIndicator}>
          <div className={styles.listeningDot} />
          LISTENING
        </div>
      )}
    </>
  );
}
