import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import type { DeviceInfo, LAFrame, ScopeConfig } from '../store/appStore';
import { generateBrowserMockFrame } from '../utils/browserMockHardware';

function shouldUseBrowserMock(): boolean {
  const host = window.location.hostname;
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
}

export function useDeviceSocket() {
  const setHardwareFrame    = useAppStore((s) => s.setHardwareFrame);
  const setScopeStatus      = useAppStore((s) => s.setScopeStatus);
  const setAutosetBusy      = useAppStore((s) => s.setAutosetBusy);
  const addPackets          = useAppStore((s) => s.addPackets);
  const setConnectionStatus = useAppStore((s) => s.setConnectionStatus);
  const _setScopeSend       = useAppStore((s) => s._setScopeSend);
  const setDevices          = useAppStore((s) => s.setDevices);
  const setLAFrame          = useAppStore((s) => s.setLAFrame);
  const setPendingDeviceToast = useAppStore((s) => s.setPendingDeviceToast);
  const setLAError          = useAppStore((s) => s.setLAError);
  const demoScenario        = useAppStore((s) => s.demoScenario);

  const wsRef    = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mockRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tracks device IDs currently seen with non-searching status
  const knownDeviceIdsRef = useRef<Set<string>>(new Set(['scope-1']));

  useEffect(() => {
    // ── Browser mock (deployed / non-localhost) ───────────────────────────────
    if (shouldUseBrowserMock()) {
      setConnectionStatus('connected');
      mockRef.current = setInterval(() => {
        const frame = generateBrowserMockFrame(useAppStore.getState().demoScenario);
        setHardwareFrame({
          timestamp:    frame.timestamp,
          mode:         frame.mode,
          scenario:     frame.scenario,
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

    // ── Real WebSocket ────────────────────────────────────────────────────────
    let alive = true;

    function handleScopeConfig(data: Record<string, unknown>) {
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
    }

    function handleScopeDataFrame(data: Record<string, unknown>) {
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

    function handleDeviceList(list: DeviceInfo[]) {
      setDevices(list);
      for (const d of list) {
        if (d.status === 'searching' || d.status === 'error') {
          // Remove from known so a future reconnect triggers the toast again
          knownDeviceIdsRef.current.delete(d.id);
          continue;
        }
        if (!knownDeviceIdsRef.current.has(d.id)) {
          knownDeviceIdsRef.current.add(d.id);
          // Only toast for non-scope devices
          if (d.kind !== 'hantek6022') {
            setPendingDeviceToast(d);
          }
        }
      }
    }

    function connect() {
      if (!alive) return;
      setConnectionStatus('connecting');

      const ws = new WebSocket(`ws://${window.location.hostname}:5001`);
      wsRef.current = ws;

      _setScopeSend((cmd) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(cmd));
        }
      });

      ws.onopen = () => {
        if (!alive) { ws.close(); return; }
        setConnectionStatus('connected');
        ws.send(JSON.stringify({
          type: 'set_scenario',
          scenario: useAppStore.getState().demoScenario,
        }));
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data as string) as Record<string, unknown>;

          // ── Device list ─────────────────────────────────────────────────
          if (data.type === 'devices') {
            handleDeviceList(data.list as DeviceInfo[]);
            return;
          }

          // ── LA data frame ───────────────────────────────────────────────
          if (data.type === 'frame' && data.device === 'la-1') {
            setLAFrame(data as unknown as LAFrame);
            return;
          }

          // ── Scope data frame (new protocol) ─────────────────────────────
          if (data.type === 'frame' && (!data.device || data.device === 'scope-1')) {
            handleScopeDataFrame(data);
            return;
          }

          // ── Scope data frame (old scope_server.py protocol) ─────────────
          if (data.type === 'hardware_update') {
            handleScopeDataFrame(data);
            return;
          }

          // ── Scope config echo (new: "config", old: "status") ────────────
          if (data.type === 'config' && (!data.device || data.device === 'scope-1')) {
            handleScopeConfig(data);
            return;
          }
          if (data.type === 'status') {
            handleScopeConfig(data);
            return;
          }

          // ── Error frame ──────────────────────────────────────────────────
          if (data.type === 'error') {
            if (data.device === 'la-1') {
              setLAError(data.message as string ?? 'Logic analyzer error');
            }
            return;
          }

          // ── Autoset frames ───────────────────────────────────────────────
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
