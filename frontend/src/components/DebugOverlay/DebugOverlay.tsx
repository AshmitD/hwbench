import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { useAppStore, ChatMessage, VOLT_PER_DIV, HardwareFrame, Packet } from '../../store/appStore';
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
      if (inCode) { flushCode(); inCode = false; } else { flushList(); inCode = true; }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }
    if (line.startsWith('### ')) { flushList(); elements.push(<h3 key={keyIdx++}>{renderInline(line.slice(4))}</h3>); continue; }
    if (line.startsWith('## '))  { flushList(); elements.push(<h2 key={keyIdx++}>{renderInline(line.slice(3))}</h2>); continue; }
    if (line.startsWith('# '))   { flushList(); elements.push(<h1 key={keyIdx++}>{renderInline(line.slice(2))}</h1>); continue; }
    if (line.startsWith('- ') || line.startsWith('* ')) { listItems.push(line.slice(2)); continue; }
    if (line.match(/^\d+\. /)) { listItems.push(line.replace(/^\d+\. /, '')); continue; }
    if (line.trim() === '') { flushList(); continue; }
    flushList();
    elements.push(<p key={keyIdx++}>{renderInline(line)}</p>);
  }
  flushList(); flushCode();
  return elements;
}

// ─── Live signal insight computation (no API calls) ───────────────────────────
interface SignalInsights {
  chips: string[];
  status: 'nominal' | 'anomaly';
  statusText: string;
}

function computeSignalInsights(frame: HardwareFrame | null, packets: Packet[]): SignalInsights {
  const chips: string[] = [];
  let anomaly = false;

  const ch1 = frame?.oscilloscope.ch1;
  if (ch1) {
    const freq = ch1.frequency >= 1000
      ? `${(ch1.frequency / 1000).toFixed(2)}kHz`
      : `${ch1.frequency.toFixed(0)}Hz`;
    chips.push(`CH1 ${freq} · ${ch1.vpp.toFixed(2)}Vpp`);
  }

  const recent = packets.slice(-30);
  const nacks = recent.filter(p => p.ack === false);
  const faults = recent.filter(p => p.decoded?.toUpperCase().includes('FAULT'));
  const i2cPkts = recent.filter(p => p.protocol === 'I2C');
  const spiPkts  = recent.filter(p => p.protocol === 'SPI');
  const uartPkts = recent.filter(p => p.protocol === 'UART');

  if (nacks.length > 0) {
    anomaly = true;
    const addr = nacks[nacks.length - 1].address ?? '?';
    chips.push(`I2C NACK at ${addr} ×${nacks.length}`);
  } else if (faults.length > 0) {
    anomaly = true;
    chips.push((faults[0].decoded ?? 'Driver fault read').slice(0, 30));
  } else if (i2cPkts.length > 0) {
    const addrs = [...new Set(i2cPkts.map(p => p.address).filter(Boolean))].slice(0, 2);
    chips.push(`I2C ${addrs.join(' ')} responding`);
  } else if (spiPkts.length > 0) {
    chips.push(`SPI — ${spiPkts.length} frames active`);
  } else if (uartPkts.length > 0) {
    const last = uartPkts[uartPkts.length - 1];
    chips.push(`UART: ${(last.decoded ?? '…').slice(0, 24)}`);
  }

  const ch2 = frame?.oscilloscope.ch2;
  if (ch2 && chips.length < 3) {
    const freq = ch2.frequency >= 1000
      ? `${(ch2.frequency / 1000).toFixed(2)}kHz`
      : `${ch2.frequency.toFixed(0)}Hz`;
    chips.push(`CH2 ${freq} · ${ch2.vpp.toFixed(2)}Vpp`);
  }

  return {
    chips: chips.slice(0, 3),
    status: anomaly ? 'anomaly' : 'nominal',
    statusText: anomaly ? 'Anomaly detected' : 'Signals nominal',
  };
}

// ─── Context builder ──────────────────────────────────────────────────────────
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
    demo_scenario: s.demoScenario,
    mode: s.hardwareFrame?.mode ?? 'mock',
  };
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function DebugOverlay() {
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [insights, setInsights] = useState<SignalInsights>({ chips: [], status: 'nominal', statusText: 'Signals nominal' });
  const autoTriggeredRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recogRef = useRef<unknown>(null);

  const s = useAppStore();
  const { messages, isStreaming, debugOverlayOpen: open, addMessage, appendToLastMessage, setIsStreaming, setDebugOverlayOpen, setLastDebugSummary } = s;

  const visibleMessages = messages.filter(m => !m.hidden).slice(-8);

  // Live insights — update every 1.5s, pure client-side, no API calls
  useEffect(() => {
    const update = () => {
      const { hardwareFrame, packets } = useAppStore.getState();
      setInsights(computeSignalInsights(hardwareFrame, packets));
    };
    update();
    const id = setInterval(update, 1500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Analyzing context counter ───────────────────────────────────────────────
  const { hardwareFrame, packets } = s;
  const channelCount = hardwareFrame ? 2 : 0;
  const packetSampleCount = Math.min(packets.length, 20);

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
      let assistantText = '';
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
          try { const p = JSON.parse(payload); if (p.text) assistantText += p.text; } catch { /* skip */ }
        }
      }
      if (assistantText.trim()) {
        const firstLine = assistantText.replace(/\*\*/g, '').split('\n').find(line => line.trim())?.trim();
        setLastDebugSummary(firstLine?.replace(/^[-*]\s*/, '') ?? assistantText.trim().slice(0, 160));
      }
    } catch (e) {
      appendToLastMessage(`\n\n[Error: ${e instanceof Error ? e.message : 'failed'}]`);
    } finally {
      setIsStreaming(false);
    }
  };

  // ── Run Debug ──────────────────────────────────────────────────────────────
  const runDebug = (note = '') => {
    const trimmed = note.trim();
    const prompt = trimmed
      ? `Analyze current bench state for the ${s.demoScenario} demo. Engineer note: ${trimmed}`
      : `Analyze current bench state for the ${s.demoScenario} demo. If there is no clear fault, say so.`;
    send(prompt, true);
  };

  const openPanel = () => setDebugOverlayOpen(true);
  const closePanel = () => { setDebugOverlayOpen(false); autoTriggeredRef.current = false; };

  useEffect(() => {
    if (!open || autoTriggeredRef.current) return;
    autoTriggeredRef.current = true;
    setTimeout(() => runDebug(''), 100);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Voice recognition ──────────────────────────────────────────────────────
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
      if (e.code === 'KeyM') { e.preventDefault(); stopListening(); }
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isStreaming]);

  const handleInputKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  // Is the last visible message an assistant still loading (empty content)?
  const lastMsg = visibleMessages[visibleMessages.length - 1];
  const isAnalyzing = isStreaming && (!lastMsg || (lastMsg.role === 'assistant' && lastMsg.content === ''));

  return (
    <>
      {!open && (
        <button className={styles.floatBtn} onClick={openPanel} title="Open AI debug panel (or hold M to voice-activate)">
          <span className={styles.floatBtnDot} />
          ⚡ DEBUG
        </button>
      )}

      {open && (
        <div className={styles.overlay}>
          <div className={styles.backdrop} onClick={closePanel} />
          <div className={styles.panel}>

            {/* Header */}
            <div className={styles.panelHeader}>
              <div className={styles.panelDot} />
              <span className={styles.panelTitle}>AI DEBUG</span>
              <div className={`${styles.statusBadge} ${insights.status === 'anomaly' ? styles.statusAnomaly : styles.statusNominal}`}>
                <span className={styles.statusDot} />
                {insights.statusText}
              </div>
              <button className={styles.closeBtn} onClick={closePanel} title="Close (Esc)">✕</button>
            </div>

            {/* Live signal insights — computed client-side, no API */}
            <div className={styles.liveSection}>
              <span className={styles.liveSectionLabel}>LIVE SIGNALS</span>
              <div className={styles.insightChips}>
                {insights.chips.length > 0
                  ? insights.chips.map((chip, i) => (
                      <span
                        key={i}
                        className={`${styles.insightChip} ${insights.status === 'anomaly' && i === 1 ? styles.insightChipAnomaly : ''}`}
                      >
                        {chip}
                      </span>
                    ))
                  : <span className={styles.insightChipMuted}>Waiting for signal data…</span>
                }
              </div>
            </div>

            {/* Messages */}
            <div className={styles.messages}>
              {isAnalyzing && (
                <div className={styles.analyzingRow}>
                  <div className={styles.spinner} />
                  Analyzing {channelCount} channels + {packetSampleCount} packets…
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

              {visibleMessages.length === 0 && !isStreaming && (
                <div className={styles.emptyHint}>
                  Run Debug to analyze the current bench state with AI.
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Bottom bar — input + send + run debug */}
            <div className={styles.bottomBar}>
              <div className={styles.inputRow}>
                <textarea
                  ref={inputRef}
                  className={styles.input}
                  placeholder="Optional note or follow-up question…"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleInputKey}
                  disabled={isStreaming}
                  rows={1}
                />
                <button className={styles.sendBtn} onClick={() => send(input)} disabled={!input.trim() || isStreaming} title="Send message">↑</button>
              </div>
              <button
                className={styles.runDebugBtn}
                onClick={() => { const note = input; setInput(''); runDebug(note); }}
                disabled={isStreaming}
              >
                {isStreaming ? 'Analyzing…' : 'Run Debug'}
              </button>
            </div>

          </div>
        </div>
      )}

      {isListening && (
        <div className={styles.listeningIndicator}>
          <div className={styles.listeningDot} />
          LISTENING
        </div>
      )}
    </>
  );
}
