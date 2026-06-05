import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';

export function useHardwareSocket() {
  const setHardwareFrame = useAppStore((s) => s.setHardwareFrame);
  const addPackets = useAppStore((s) => s.addPackets);
  const setConnectionStatus = useAppStore((s) => s.setConnectionStatus);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;

    function connect() {
      if (!alive) return;
      setConnectionStatus('connecting');

      const ws = new WebSocket(`ws://${window.location.hostname}:5001`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!alive) { ws.close(); return; }
        setConnectionStatus('connected');
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'hardware_update') {
            setHardwareFrame({
              timestamp: data.timestamp,
              mode: data.mode,
              oscilloscope: data.oscilloscope,
            });
            if (data.protocol?.newPackets?.length > 0) {
              addPackets(data.protocol.newPackets);
            }
          }
        } catch { /* ignore malformed frames */ }
      };

      ws.onclose = () => {
        setConnectionStatus('disconnected');
        if (alive) {
          retryRef.current = setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      alive = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [setHardwareFrame, addPackets, setConnectionStatus]);
}
