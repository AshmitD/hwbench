import { useAppStore } from '../../store/appStore';
import MultimeterPanel from '../Hardware/MultimeterPanel';

const WAVE_ICONS: Record<string, string> = { sine: '∿', square: '⊓', triangle: '△', sawtooth: '⟋' };

export default function FuncGenPanel() {
  const s = useAppStore();
  const set = s.set;

  const freqHz = s.funcFrequency * (s.funcFreqUnit === 'MHz' ? 1e6 : s.funcFreqUnit === 'kHz' ? 1e3 : 1);

  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
  const label: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--text-tertiary)', width: 36, flexShrink: 0 };
  const segGroup: React.CSSProperties = { display: 'flex', gap: 4 };
  const seg = (active: boolean): React.CSSProperties => ({
    fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 500,
    padding: '3px 10px', borderRadius: 100,
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer', transition: 'all 0.12s',
  });
  const numInput: React.CSSProperties = {
    fontFamily: 'var(--font-mono)', fontSize: 11,
    background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
    borderRadius: 4, padding: '3px 8px', width: 80, textAlign: 'right',
    color: 'var(--text-primary)',
  };

  const outBtn = (on: boolean): React.CSSProperties => ({
    fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
    padding: '5px 16px', borderRadius: 100,
    border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
    background: on ? 'var(--accent)' : 'transparent',
    color: on ? '#fff' : 'var(--text-tertiary)',
    cursor: 'pointer', letterSpacing: '0.06em', transition: 'all 0.12s',
  });

  return (
    <div style={{ height: '100%', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      {/* Function Generator */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 14 }}>
          Function Generator
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Waveform */}
          <div style={row}>
            <span style={label}>WAVE</span>
            <div style={segGroup}>
              {(['sine','square','triangle','sawtooth'] as const).map(w => (
                <button key={w} style={seg(s.funcWaveform === w)} onClick={() => set({ funcWaveform: w })}>
                  {WAVE_ICONS[w]}
                </button>
              ))}
            </div>
          </div>

          {/* Frequency */}
          <div style={row}>
            <span style={label}>FREQ</span>
            <input style={numInput} type="number" value={s.funcFrequency} min="0.001" step="0.1"
              onChange={e => set({ funcFrequency: parseFloat(e.target.value) || 1 })} />
            <div style={segGroup}>
              {(['Hz','kHz','MHz'] as const).map(u => (
                <button key={u} style={seg(s.funcFreqUnit === u)} onClick={() => set({ funcFreqUnit: u })}>{u}</button>
              ))}
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)' }}>
              = {freqHz >= 1e6 ? `${(freqHz/1e6).toFixed(3)}MHz` : freqHz >= 1e3 ? `${(freqHz/1e3).toFixed(3)}kHz` : `${freqHz.toFixed(1)}Hz`}
            </span>
          </div>

          {/* Amplitude */}
          <div style={row}>
            <span style={label}>AMP</span>
            <input style={numInput} type="number" value={s.funcAmplitude} min="0" step="0.1"
              onChange={e => set({ funcAmplitude: parseFloat(e.target.value) || 0 })} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)' }}>Vpp</span>
            <span style={{ ...label, marginLeft: 12 }}>OFS</span>
            <input style={numInput} type="number" value={s.funcOffset} step="0.1"
              onChange={e => set({ funcOffset: parseFloat(e.target.value) || 0 })} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)' }}>V</span>
          </div>

          {/* Outputs */}
          <div style={row}>
            <span style={label}>OUT</span>
            <button style={outBtn(s.funcW1)} onClick={() => set({ funcW1: !s.funcW1 })}>W1 {s.funcW1 ? 'ON' : 'OFF'}</button>
            <button style={outBtn(s.funcW2)} onClick={() => set({ funcW2: !s.funcW2 })}>W2 {s.funcW2 ? 'ON' : 'OFF'}</button>
            {s.funcW2 && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)' }}>↳ overrides CH2</span>
            )}
          </div>
        </div>
      </div>

      {/* Multimeter */}
      <div style={{ padding: '14px 20px' }}>
        <div style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 14 }}>
          Multimeter
        </div>
        <MultimeterPanel inline />
      </div>
    </div>
  );
}
