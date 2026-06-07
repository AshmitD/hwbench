import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { generateBrowserMockFrame } from '../utils/browserMockHardware';

function shouldUseBrowserMock(): boolean {
  const host = window.location.hostname;
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
}

export function useHardwareSocket() {
  const setHardwareFrame = useAppStore((s) => s.setHardwareFrame);
  const addPackets = useAppStore((s) => s.addPackets);
  const setConnectionStatus = useAppStore((s) => s.setConnectionStatus);
  const demoScenario = useAppStore((s) => s.demoScenario);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const browserMockRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (shouldUseBrowserMock()) {
      setConnectionStatus('connected');
      browserMockRef.current = setInterval(() => {
        const frame = generateBrowserMockFrame(useAppStore.getState().demoScenario);
        setHardwareFrame({
          timestamp: frame.timestamp,
          mode: frame.mode,
          scenario: frame.scenario,
          oscilloscope: frame.oscilloscope,
        });
        if (frame.protocol.newPackets.length > 0) {
          addPackets(frame.protocol.newPackets);
        }
      }, 50);

      return () => {
        if (browserMockRef.current) clearInterval(browserMockRef.current);
      };
    }

    let alive = true;

    function connect() {
      if (!alive) return;
      setConnectionStatus('connecting');

      const ws = new WebSocket(`ws://${window.location.hostname}:5001`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!alive) { ws.close(); return; }
        setConnectionStatus('connected');
        ws.send(JSON.stringify({ type: 'set_scenario', scenario: useAppStore.getState().demoScenario }));
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'hardware_update') {
            setHardwareFrame({
              timestamp: data.timestamp,
              mode: data.mode,
              scenario: data.scenario,
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

  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'set_scenario', scenario: demoScenario }));
    }
  }, [demoScenario]);
}
