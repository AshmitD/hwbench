import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { useAppStore, ChatMessage, VOLT_PER_DIV } from '../../store/appStore';
import styles from './AIPanel.module.css';

const PROMPT_CHIPS = [
  "What's causing the noise on CH1?",
  "Why are the I2C reads returning 0xFF?",
  "Is the signal level on CH2 correct for 5V logic?",
  "The motor is behaving erratically — what do the signals suggest?",
  "Explain what I'm seeing on the protocol decoder.",
];

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function renderContent(text: string): React.ReactNode {
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      const inner = part.slice(3, -3).replace(/^[a-z]+\n/, '');
      return <pre key={i}>{inner}</pre>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
    return boldParts.map((bp, j) =>
      bp.startsWith('**') && bp.endsWith('**')
        ? <strong key={j}>{bp.slice(2, -2)}</strong>
        : bp
    );
  });
}

export default function AIPanel() {
  const [input, setInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  const s = useAppStore();
  const { messages, isStreaming, hardwareFrame, packets, repoUrl, selectedFile,
    addMessage, appendToLastMessage, setIsStreaming } = s;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, [input]);

  const buildContext = () => {
    const ch1 = hardwareFrame?.oscilloscope.ch1;
    const ch2 = hardwareFrame?.oscilloscope.ch2;
    const fmtHz = (hz: number) => hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${hz.toFixed(1)} Hz`;
    const fmtV = (v: number) => `${v.toFixed(3)}V`;
    const ch1VPD = VOLT_PER_DIV[s.ch1VoltPerDivIdx];
    const ch2VPD = VOLT_PER_DIV[s.ch2VoltPerDivIdx];

    const protocolLines = packets.slice(-20).map(p => {
      if (p.protocol === 'I2C') return `[${p.timestamp}] I2C ${p.direction} addr=${p.address} reg=${p.register} data=[${p.data.join(' ')}]${p.decoded ? ` → ${p.decoded}` : ''}`;
      if (p.protocol === 'SPI') return `[${p.timestamp}] SPI ${p.direction} ${p.address} reg=${p.register} data=[${p.data.join(' ')}]${p.decoded ? ` → ${p.decoded}` : ''}`;
      return `[${p.timestamp}] UART ${p.direction}${p.decoded ? ` "${p.decoded}"` : ''}`;
    });

    let codeCtx: string | null = null;
    if (selectedFile) codeCtx = `FILE: ${selectedFile.path}\n\`\`\`\n${selectedFile.content.slice(0, 6000)}\n\`\`\``;
    else if (repoUrl) codeCtx = `REPO: ${repoUrl} (no file selected)`;

    return {
      oscilloscope: {
        ch1: ch1 ? {
          frequency: fmtHz(ch1.frequency),
          vpp: `${ch1.vpp.toFixed(2)}V`,
          vmin: fmtV(ch1.vmin), vmax: fmtV(ch1.vmax),
          coupling: s.ch1Coupling, probe: s.ch1Probe,
          voltPerDiv: `${ch1VPD < 1 ? ch1VPD * 1000 + 'mV' : ch1VPD + 'V'}`,
        } : undefined,
        ch2: ch2 ? {
          frequency: fmtHz(ch2.frequency),
          vpp: `${ch2.vpp.toFixed(2)}V`,
          vmin: fmtV(ch2.vmin), vmax: fmtV(ch2.vmax),
          coupling: s.ch2Coupling, probe: s.ch2Probe,
          voltPerDiv: `${ch2VPD < 1 ? ch2VPD * 1000 + 'mV' : ch2VPD + 'V'}`,
        } : undefined,
      },
      trigger: {
        source: s.triggerSource,
        edge: s.triggerEdge,
        level: `${s.triggerLevel >= 0 ? '+' : ''}${s.triggerLevel.toFixed(2)}V`,
        mode: s.triggerMode,
      },
      acquisition: { mode: s.acqMode, averages: s.acqMode === 'AVG' ? s.acqAvgN : null },
      protocol_traffic: protocolLines,
      function_generator: {
        waveform: s.funcWaveform,
        frequency: `${s.funcFrequency}${s.funcFreqUnit}`,
        amplitude: `${s.funcAmplitude}Vpp`,
        w1: s.funcW1,
        w2: s.funcW2,
      },
      multimeter: { mode: s.meterMode, reading: 'live' },
      code_context: codeCtx,
      mode: hardwareFrame?.mode ?? 'mock',
    };
  };

  const send = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || isStreaming) return;

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() };
    addMessage(userMsg);
    setInput('');
    setIsStreaming(true);

    const assistantMsg: ChatMessage = { id: `a-${Date.now()}`, role: 'assistant', content: '', timestamp: Date.now() };
    addMessage(assistantMsg);

    try {
      const apiMessages = messages
        .filter(m => m.content.length > 0)
        .map(m => ({ role: m.role, content: m.content }));
      apiMessages.push({ role: 'user', content: text });

      const res = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, context: buildContext() }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No response body');

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
          try {
            const parsed = JSON.parse(payload);
            if (parsed.text) appendToLastMessage(parsed.text);
          } catch { /* skip */ }
        }
      }
    } catch (e) {
      appendToLastMessage(`\n\n[Error: ${e instanceof Error ? e.message : 'Request failed'}]`);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const startVoice = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec: any = new SR();
    rec.continuous = false; rec.interimResults = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = Array.from(e.results as any[]).map((r: any) => r[0].transcript).join('');
      setInput(t);
    };
    rec.onend = () => setIsRecording(false);
    rec.start();
    recognitionRef.current = rec;
    setIsRecording(true);
  };
  const stopVoice = () => { recognitionRef.current?.stop(); setIsRecording(false); };

  const hasCode = !!selectedFile || !!repoUrl;
  const hasHardware = !!hardwareFrame;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>AI Assistant</span>
        <span className={`${styles.contextBadge} ${hasHardware ? styles.active : ''}`}>HW</span>
        <span className={`${styles.contextBadge} ${hasCode ? styles.active : ''}`}>CODE</span>
      </div>

      <div className={styles.messages}>
        {messages.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>⚡</div>
            <div className={styles.emptyTitle}>Hardware AI Assistant</div>
            <div className={styles.emptyHint}>
              Claude has live visibility into your oscilloscope, protocol decoder, and instrument settings. Ask anything specific.
            </div>
            <div className={styles.chips}>
              {PROMPT_CHIPS.map(chip => (
                <button key={chip} className={styles.chip} onClick={() => send(chip)}>
                  {chip}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => {
            const isLast = i === messages.length - 1;
            const showCursor = isLast && msg.role === 'assistant' && isStreaming;
            return (
              <div key={msg.id} className={`${styles.message} ${styles[msg.role]}`}>
                <div className={styles.messageMeta}>
                  <span className={styles.messageRole}>{msg.role === 'user' ? 'you' : 'claude'}</span>
                  <span>{formatTime(msg.timestamp)}</span>
                </div>
                <div className={styles.messageBubble}>
                  {renderContent(msg.content)}
                  {showCursor && <span className={styles.cursor} />}
                  {isLast && msg.role === 'assistant' && msg.content === '' && isStreaming && <span className={styles.cursor} />}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className={styles.inputArea}>
        <div className={styles.inputRow}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            placeholder={isStreaming ? 'Waiting…' : 'Ask about your signals…'}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={isStreaming}
            rows={1}
          />
          <button
            className={`${styles.voiceBtn} ${isRecording ? styles.recording : ''}`}
            onMouseDown={startVoice} onMouseUp={stopVoice}
            onTouchStart={startVoice} onTouchEnd={stopVoice}
            title="Hold to speak"
          >🎤</button>
          <button className={styles.sendBtn} onClick={() => send()} disabled={!input.trim() || isStreaming} title="Send (Enter)">↑</button>
        </div>
        <div className={styles.hint}>
          <span><span className={styles.hintKey}>Enter</span> send</span>
          <span><span className={styles.hintKey}>Shift+Enter</span> newline</span>
        </div>
      </div>
    </div>
  );
}
