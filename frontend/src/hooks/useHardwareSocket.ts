import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import type { ScopeConfig } from '../store/appStore';
import { generateBrowserMockFrame } from '../utils/browserMockHardware';

function shouldUseBrowserMock(): boolean {
  const host = window.location.hostname;
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
}

export function useHardwareSocket() {
  const setHardwareFrame   = useAppStore((s) => s.setHardwareFrame);
  const setScopeStatus     = useAppStore((s) => s.setScopeStatus);
  const setAutosetBusy     = useAppStore((s) => s.setAutosetBusy);
  const addPackets         = useAppStore((s) => s.addPackets);
  const setConnectionStatus = useAppStore((s) => s.setConnectionStatus);
  const _setScopeSend      = useAppStore((s) => s._setScopeSend);
  const demoScenario       = useAppStore((s) => s.demoScenario);

  const wsRef       = useRef<WebSocket | null>(null);
  const retryRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mockRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // ── Browser mock (deployed / non-localhost) ───────────────────────────────
    if (shouldUseBrowserMock()) {
      setConnectionStatus('connected');
      mockRef.current = setInterval(() => {
        const frame = generateBrowserMockFrame(useAppStore.getState().demoScenario);
        setHardwareFrame({
          timestamp:   frame.timestamp,
          mode:        frame.mode,
          scenario:    frame.scenario,
          oscilloscope: frame.oscilloscope,
        });
        if (frame.protocol.newPackets.length > 0) {
          addPackets(frame.protocol.newPackets);
        }
      }, 50);
      return () => {
        if (mockRef.current) clearInterval(mockRef.current);
      };
    }

    // ── Real WebSocket connection ─────────────────────────────────────────────
    let alive = true;

    function connect() {
      if (!alive) return;
      setConnectionStatus('connecting');

      const ws = new WebSocket(`ws://${window.location.hostname}:5001`);
      wsRef.current = ws;

      // Expose send function to the store so any component can issue commands
      _setScopeSend((cmd) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(cmd));
        }
      });

      ws.onopen = () => {
        if (!alive) { ws.close(); return; }
        setConnectionStatus('connected');
        // Send the current demo scenario so mock frames match if server falls back
        ws.send(JSON.stringify({
          type: 'set_scenario',
          scenario: useAppStore.getState().demoScenario,
        }));
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data as string) as Record<string, unknown>;

          // ── Autoset frames ────────────────────────────────────────────────
          if (data.type === 'autoset_start') {
            setAutosetBusy(true);
            return;
          }

          if (data.type === 'autoset_done') {
            const rawCfg = data.config as Record<string, number> | undefined;
            const display = data.display as Record<string, number | string> | undefined;

            if (rawCfg) {
              const cfg: ScopeConfig = {
                sampleRate:      rawCfg.sample_rate,
                timeSpanMs:      rawCfg.time_span_ms ?? 0,
                numChannels:     rawCfg.num_channels,
                ch1VoltageRange: rawCfg.ch1_voltage_range,
                ch2VoltageRange: rawCfg.ch2_voltage_range,
              };
              setScopeStatus('connected', cfg);
            }

            if (display) {
              useAppStore.getState().set({
                ch1VoltPerDivIdx: display.ch1_volt_per_div_idx as number,
                ch2VoltPerDivIdx: display.ch2_volt_per_div_idx as number,
                triggerSource:    display.trigger_source as 'CH1' | 'CH2',
                triggerLevel:     display.trigger_level as number,
                triggerMode:      display.trigger_mode as 'AUTO' | 'NORM' | 'SINGLE',
                triggerEdge:      display.trigger_edge as 'rising' | 'falling',
              });
            }

            setAutosetBusy(false);
            return;
          }

          // ── Status frame ──────────────────────────────────────────────────
          if (data.type === 'status') {
            const rawCfg = data.config as Record<string, number> | undefined;
            const cfg: ScopeConfig | undefined = rawCfg ? {
              sampleRate:      rawCfg.sample_rate,
              timeSpanMs:      rawCfg.time_span_ms ?? 0,
              numChannels:     rawCfg.num_channels,
              ch1VoltageRange: rawCfg.ch1_voltage_range,
              ch2VoltageRange: rawCfg.ch2_voltage_range,
            } : undefined;
            setScopeStatus(
              (data.scope_status as 'connected' | 'searching') ?? null,
              cfg,
            );
            return;
          }

          // ── Data frame ────────────────────────────────────────────────────
          if (data.type === 'hardware_update') {
            const rawCfg = data.config as Record<string, number> | undefined;
            const cfg: ScopeConfig | undefined = rawCfg ? {
              sampleRate:      rawCfg.sample_rate,
              timeSpanMs:      rawCfg.time_span_ms ?? 0,
              numChannels:     rawCfg.num_channels,
              ch1VoltageRange: rawCfg.ch1_voltage_range,
              ch2VoltageRange: rawCfg.ch2_voltage_range,
            } : undefined;

            if (cfg) {
              setScopeStatus(
                (data.scope_status as 'connected' | 'searching') ?? 'connected',
                cfg,
              );
            }

            setHardwareFrame({
              timestamp:    data.timestamp as number,
              mode:         data.mode as 'mock' | 'live',
              scenario:     data.scenario as never,
              scope_status: data.scope_status as 'connected' | 'searching' | undefined,
              config:       cfg,
              oscilloscope: data.oscilloscope as never,
            });

            const proto = data.protocol as { newPackets?: unknown[] } | undefined;
            if (proto?.newPackets?.length) {
              addPackets(proto.newPackets as never);
            }
          }
        } catch { /* ignore malformed */ }
      };

      ws.onclose = () => {
        setConnectionStatus('disconnected');
        _setScopeSend(() => { /* no-op when disconnected */ });
        if (alive) {
          retryRef.current = setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      alive = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
      _setScopeSend(() => { /* no-op on unmount */ });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-send scenario when it changes (for mock/demo scenarios on Node backend)
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'set_scenario', scenario: demoScenario }));
    }
  }, [demoScenario]);
}
