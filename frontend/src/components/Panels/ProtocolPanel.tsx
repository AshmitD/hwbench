import { useAppStore } from '../../store/appStore';
import ProtocolTraffic from '../Hardware/ProtocolTraffic';

export default function ProtocolPanel() {
  const packets = useAppStore(s => s.packets);
  const protocolPaused = useAppStore(s => s.protocolPaused);
  const toggleProtocolPause = useAppStore(s => s.toggleProtocolPause);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-secondary)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 14px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-secondary)', flexShrink: 0,
      }}>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
          Protocol Decoder
        </span>
        {(['I2C','SPI','UART'] as const).map(p => (
          <span key={p} style={{
            fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600,
            padding: '1px 6px', borderRadius: 100,
            background: p === 'I2C' ? 'var(--i2c-bg)' : p === 'SPI' ? 'var(--spi-bg)' : 'var(--uart-bg)',
            color: p === 'I2C' ? 'var(--i2c)' : p === 'SPI' ? 'var(--spi)' : 'var(--uart)',
          }}>{p}</span>
        ))}
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)' }}>
          {packets.length} pkts
        </span>
        <button
          onClick={toggleProtocolPause}
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
            padding: '3px 10px', borderRadius: 100,
            border: `1px solid ${protocolPaused ? 'rgba(217,119,6,0.3)' : 'rgba(22,163,74,0.3)'}`,
            color: protocolPaused ? 'var(--accent)' : 'var(--success)',
            background: protocolPaused ? 'var(--accent-light)' : 'rgba(22,163,74,0.06)',
            cursor: 'pointer',
          }}
        >
          {protocolPaused ? '⏸ PAUSED' : '▶ RUN'}
        </button>
      </div>
      <ProtocolTraffic packets={packets} paused={protocolPaused} />
    </div>
  );
}
