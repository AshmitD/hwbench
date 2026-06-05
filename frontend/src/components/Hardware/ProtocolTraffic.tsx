import { useEffect, useRef } from 'react';
import { Packet } from '../../store/appStore';
import styles from './HardwarePanel.module.css';

interface Props {
  packets: Packet[];
  paused: boolean;
}

const PROTO_COLORS: Record<string, string> = {
  I2C: 'var(--i2c)',
  SPI: 'var(--spi)',
  UART: 'var(--uart)',
};

function formatPacket(pkt: Packet): { label: string; detail: string } {
  if (pkt.protocol === 'I2C') {
    const dataStr = pkt.data.slice(0, 6).join(' ');
    const extra = pkt.data.length > 6 ? ` +${pkt.data.length - 6}` : '';
    const label = `${pkt.direction} ${pkt.address} ${pkt.register ? `REG:${pkt.register}` : ''}`;
    const detail = pkt.decoded || `[${dataStr}${extra}]${pkt.ack ? ' ACK' : ' NAK'}`;
    return { label, detail };
  }
  if (pkt.protocol === 'SPI') {
    const label = `${pkt.direction} ${pkt.address || 'CS0'} ${pkt.register ? `@${pkt.register}` : ''}`;
    const detail = pkt.decoded || `[${pkt.data.join(' ')}]`;
    return { label, detail };
  }
  return { label: pkt.direction, detail: pkt.decoded || pkt.data.join(' ') };
}

export default function ProtocolTraffic({ packets, paused }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoscrollRef = useRef(true);

  // Track displayed packet count — frozen at pause time
  const frozenCountRef = useRef(packets.length);
  const prevPausedRef = useRef(false);

  // Capture freeze point when pause engages
  useEffect(() => {
    const wasRunning = !prevPausedRef.current;
    if (paused && wasRunning) {
      frozenCountRef.current = packets.length;
    }
    if (!paused && prevPausedRef.current) {
      // Just unpaused: jump to latest
      frozenCountRef.current = packets.length;
      autoscrollRef.current = true;
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
    }
    prevPausedRef.current = paused;
  }, [paused, packets.length]);

  // Auto-scroll when running
  useEffect(() => {
    if (!paused && autoscrollRef.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'instant' });
    }
  }, [packets, paused]);

  const handleScroll = () => {
    if (paused) return; // user is browsing history — don't hijack
    const el = containerRef.current;
    if (!el) return;
    autoscrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  };

  const displayPackets = paused ? packets.slice(0, frozenCountRef.current) : packets;
  const buffered = paused ? Math.max(0, packets.length - frozenCountRef.current) : 0;

  return (
    <div className={styles.protocolTrafficWrapper}>
      {paused && buffered > 0 && (
        <div className={styles.pausedBanner}>
          PAUSED — {buffered} packet{buffered !== 1 ? 's' : ''} buffered
        </div>
      )}
      <div
        ref={containerRef}
        className={styles.protocolScroll}
        onScroll={handleScroll}
      >
        {displayPackets.length === 0 ? (
          <div className={styles.protocolEmpty}>Waiting for protocol traffic…</div>
        ) : (
          displayPackets.map((pkt) => {
            const color = PROTO_COLORS[pkt.protocol] || 'var(--text-muted)';
            const { label, detail } = formatPacket(pkt);
            return (
              <div key={pkt.id} className={styles.packetRow}>
                <span className={styles.packetTs}>{pkt.timestamp}</span>
                <span className={styles.packetProto} style={{ color }}>
                  {pkt.protocol}
                </span>
                <span className={styles.packetLabel}>{label}</span>
                <span className={styles.packetDetail}>{detail}</span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
