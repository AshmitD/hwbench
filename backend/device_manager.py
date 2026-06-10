#!/usr/bin/env python3
"""
HWBench device manager — multi-instrument WebSocket bridge.

Hosts the Hantek 6022BE oscilloscope and FX2 logic analyzer over a single
WebSocket endpoint on port 5001.

Run:  python3 backend/device_manager.py
Deps: pip install websockets PyHT6022   (PyHT6022 needs libusb)
      brew install sigrok-cli           (for FX2 LA support)

━━━ Protocol ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Server → Client (JSON):

  { "type": "devices", "list": [
      { "id": "scope-1", "kind": "hantek6022", "label": "Hantek 6022BE",
        "status": "connected"|"searching" },
      { "id": "la-1", "kind": "fx2-la", "label": "FX2 Logic Analyzer 8CH",
        "status": "running"|"stopped"|"searching" }
  ]}

  { "type": "frame", "device": "scope-1",
    "mode": "live", "scope_status": "connected"|"searching",
    "config": { "sample_rate": 20000, "time_span_ms": 50.0, "num_channels": 1,
                "ch1_voltage_range": 1, "ch2_voltage_range": 1 },
    "oscilloscope": { "ch1": {...}, "ch2": null },
    "protocol": { "newPackets": [] } }

  { "type": "config", "device": "scope-1", "scope_status": "connected",
    "config": {...} }

  { "type": "autoset_start", "device": "scope-1" }
  { "type": "autoset_done",  "device": "scope-1", "config": {...}, "display": {...} }

  { "type": "frame", "device": "la-1",
    "timestamp": 1234567890, "la_status": "running"|"stopped"|"searching",
    "config": { "sample_rate": 8000000, "enabled_channels": [...],
                "time_span_ns": 100000000 },
    "channels": { "D0": { "initial": 0, "transitions": [...] }, ... },
    "overflow": false }

  { "type": "error", "device": "la-1", "message": "overflow: cannot sustain 8MHz" }

Client → Server (JSON commands):

  All existing scope commands gain optional "device" field (default "scope-1").

  { "device": "la-1", "cmd": "set_sample_rate", "value": 8000000 }
  { "device": "la-1", "cmd": "set_channels", "enabled": [0,1,2,3,4,5,6,7] }
  { "device": "la-1", "cmd": "run" }
  { "device": "la-1", "cmd": "stop" }
"""
import asyncio
import json
import shutil
import subprocess
import threading
import time
from collections import deque
from typing import Callable

import websockets

# ── Server config ─────────────────────────────────────────────────────────────
WS_HOST       = "localhost"
WS_PORT       = 5001
SEND_INTERVAL = 0.033      # ~30 fps push to clients
FRAME_SAMPLES = 1000       # downsample target for the UI
BLOCK_SIZE    = 0x1000     # 4096 raw samples per USB read
RING_SAMPLES  = 8000       # scope ring buffer depth

# Hantek 6022BE sample rates: scope_id → (actual_hz, label)
SAMPLE_RATES: dict[int, tuple[int, str]] = {
    102: (20_000, "20 kS/s"),
}
HZ_TO_ID = {hz: sid for sid, (hz, _) in SAMPLE_RATES.items()}

# Voltage range code → (one-sided full-scale V, label)
VOLT_RANGES: dict[int, tuple[float, str]] = {
    1:  (5.0,  "±5 V"),
    2:  (2.5,  "±2.5 V"),
    5:  (1.0,  "±1 V"),
    10: (0.5,  "±0.5 V"),
}

# Display V/div values — must match frontend VOLT_PER_DIV constant.
_VPDS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0]

# LA config
LA_SAMPLE_RATES = [1_000_000, 2_000_000, 4_000_000, 8_000_000, 16_000_000, 24_000_000]
FRAME_DURATION_S = 0.1    # 10 fps for LA frames
CHUNK_SIZE = 65536         # bytes per sigrok-cli read


# ══════════════════════════════════════════════════════════════════════════════
# ScopeDriver
# ══════════════════════════════════════════════════════════════════════════════

class ScopeDriver:
    """Hantek 6022BE driver, refactored from scope_server.py."""

    def __init__(self, device_id: str, publish: Callable[[str], None]):
        self.device_id = device_id
        self._publish  = publish
        self._lock     = threading.Lock()

        # Oscilloscope state
        self._scope_status      = "searching"
        self._running           = True
        self._sample_rate       = 20_000
        self._num_channels      = 1
        self._ch1_vr            = 1
        self._ch2_vr            = 1
        self._trig_mode         = "AUTO"
        self._trig_source       = "CH1"
        self._trig_edge         = "rising"
        self._trig_level        = 0.0
        self._single_done       = False
        self._ring1: deque      = deque(maxlen=RING_SAMPLES)
        self._ring2: deque      = deque(maxlen=RING_SAMPLES)
        self._pending: dict     = {}
        self._autoset_requested = False
        self._autoset_busy      = False

        self._latest: str | None = None

    # ── Public interface ───────────────────────────────────────────────────────

    @property
    def latest(self) -> str | None:
        return self._latest

    def get_info(self) -> dict:
        return {
            "id":     self.device_id,
            "kind":   "hantek6022",
            "label":  "Hantek 6022BE",
            "status": self._scope_status,
        }

    def start(self) -> None:
        t = threading.Thread(target=self._scope_thread, daemon=True)
        t.start()

    def apply_cmd(self, cmd: dict) -> None:
        c = cmd.get("cmd", "")
        with self._lock:
            if c == "run":
                self._running = True
                self._single_done = False
            elif c == "stop":
                self._running = False
            elif c == "set_sample_rate":
                hz = int(cmd.get("value", self._sample_rate))
                if hz in HZ_TO_ID:
                    self._pending["sample_rate"] = hz
            elif c == "set_voltage_range":
                ch = int(cmd.get("channel", 1))
                vr = int(cmd.get("value", 1))
                if vr in VOLT_RANGES:
                    self._pending[f"ch{ch}_vr"] = vr
            elif c == "set_channels":
                n = int(cmd.get("value", 1))
                if n in (1, 2):
                    self._pending["num_channels"] = n
            elif c == "set_trigger":
                self._trig_mode   = cmd.get("mode",   self._trig_mode)
                self._trig_source = cmd.get("source", self._trig_source)
                self._trig_edge   = cmd.get("edge",   self._trig_edge)
                self._trig_level  = float(cmd.get("level", self._trig_level))
                self._single_done = False   # re-arm SINGLE
            elif c == "autoset":
                if not self._autoset_busy:
                    self._autoset_requested = True

    # ── Internal helpers ───────────────────────────────────────────────────────

    def _config_dict(self) -> dict:
        return {
            "sample_rate":       self._sample_rate,
            "num_channels":      self._num_channels,
            "ch1_voltage_range": self._ch1_vr,
            "ch2_voltage_range": self._ch2_vr,
        }

    def _push_status(self, status: str) -> None:
        """Update scope_status and publish a config frame."""
        self._scope_status = status
        msg = json.dumps({
            "type":         "config",
            "device":       self.device_id,
            "scope_status": status,
            "config":       self._config_dict(),
        })
        self._latest = msg
        self._publish(msg)

    def _ch_dict(self, samples: list, sample_rate: int, vr: int) -> dict:
        n = len(samples)
        if n == 0:
            return {}
        vmin  = min(samples)
        vmax  = max(samples)
        mid   = (vmin + vmax) / 2
        cross = sum(1 for i in range(1, n) if samples[i-1] < mid <= samples[i])
        span  = n / sample_rate
        freq  = cross / span if cross else 0.0
        one_side = VOLT_RANGES[vr][0]
        vpd   = (one_side * 2) / 8       # volts per division (8 rows)
        tspan = round(span * 1000, 3)    # ms
        return {
            "samples":      [round(v, 4) for v in samples],
            "sample_rate":  sample_rate,
            "time_span_ms": tspan,
            "frequency":    round(freq, 2),
            "vpp":          round(vmax - vmin, 4),
            "vmin":         round(vmin, 4),
            "vmax":         round(vmax, 4),
            "period":       round(1000.0 / freq if freq > 0 else 0.0, 4),
            "voltPerDiv":   round(vpd, 4),
            "timePerDiv":   round(tspan / 10, 3),
        }

    def _find_trig(self, buf: list, level: float, edge: str, start: int, end: int) -> int:
        """Return index of first trigger crossing, or -1."""
        for i in range(start + 1, min(end, len(buf))):
            p, c = buf[i - 1], buf[i]
            if edge == "rising"  and p < level <= c: return i - 1
            if edge == "falling" and p > level >= c: return i - 1
        return -1

    def _downsample(self, arr: list) -> list:
        if len(arr) <= FRAME_SAMPLES:
            return arr
        step = max(1, len(arr) // FRAME_SAMPLES)
        return arr[::step][:FRAME_SAMPLES]

    def _build_frame(self) -> None:
        """Build trigger-aligned frame from ring buffer and publish."""
        with self._lock:
            r1   = list(self._ring1)
            r2   = list(self._ring2)
            sr   = self._sample_rate
            vr1  = self._ch1_vr
            vr2  = self._ch2_vr
            nch  = self._num_channels
            mode = self._trig_mode
            src  = self._trig_source
            edge = self._trig_edge
            lvl  = self._trig_level
            done = self._single_done
            run  = self._running

        if not run or len(r1) < FRAME_SAMPLES:
            return
        if mode == "SINGLE" and done:
            return

        ring_src = r2 if (src == "CH2" and len(r2) >= FRAME_SAMPLES) else r1

        if mode == "AUTO":
            ch1w = r1[-FRAME_SAMPLES:]
            ch2w = r2[-FRAME_SAMPLES:] if (nch >= 2 and len(r2) >= FRAME_SAMPLES) else None
        else:
            guard = FRAME_SAMPLES // 4
            t = self._find_trig(ring_src, lvl, edge, guard, len(ring_src) - FRAME_SAMPLES)
            if t == -1:
                return   # no trigger — hold last frame
            ch1w = r1[t: t + FRAME_SAMPLES]
            ch2w = r2[t: t + FRAME_SAMPLES] if (nch >= 2 and t + FRAME_SAMPLES <= len(r2)) else None
            if mode == "SINGLE":
                with self._lock:
                    self._single_done = True
                    self._running = False

        time_span_ms = round((FRAME_SAMPLES / sr) * 1000, 3)
        frame = {
            "type":         "frame",
            "device":       self.device_id,
            "timestamp":    int(time.time() * 1000),
            "mode":         "live",
            "scope_status": "connected",
            "config": {
                "sample_rate":       sr,
                "time_span_ms":      time_span_ms,
                "num_channels":      nch,
                "ch1_voltage_range": vr1,
                "ch2_voltage_range": vr2,
            },
            "oscilloscope": {
                "ch1": self._ch_dict(self._downsample(ch1w), sr, vr1),
                "ch2": self._ch_dict(self._downsample(ch2w), sr, vr2) if ch2w else None,
            },
            "protocol": {"newPackets": []},
        }
        msg = json.dumps(frame)
        self._latest = msg
        self._publish(msg)

    def _run_autoset(self, scope) -> None:
        """
        Full hardware autoset sequence.  Called from the scope thread — has
        direct hardware access.  Never raises; capture is always resumed.

        Algorithm
        ---------
        1. Capture a burst at the widest voltage range (VR 1, ±5 V).
        2. Measure peak-to-peak for each active channel and choose the
           tightest hardware range that fits with 15 % headroom.
        3. Re-capture at the chosen ranges for accurate signal measurement.
        4. Detect dominant frequency via rising midpoint zero-crossings.
        5. Set trigger: source = CH1, rising edge, level = 50 % point, AUTO mode.
        6. Compute the display V/div indices that fill ~75 % of the 8-row grid.
        7. Broadcast autoset_done with hardware config + display hints.
        """
        print("[Scope] Autoset: starting…")
        msg = json.dumps({"type": "autoset_start", "device": self.device_id})
        self._latest = msg
        self._publish(msg)

        nch   = self._num_channels
        sr    = self._sample_rate
        VR_FS = {1: 5.0, 2: 2.5, 5: 1.0, 10: 0.5}   # code → one-sided full-scale V

        # ── Helper: read nblocks directly from hardware ───────────────────────
        def _capture(vr1: int, vr2: int, nblocks: int = 3):
            ch1_out: list = []
            ch2_out: list = []
            for _ in range(nblocks):
                try:
                    r1, r2 = scope.read_data(BLOCK_SIZE)
                    ch1_out.extend(scope.scale_read_data(r1, vr1))
                    if nch >= 2 and r2:
                        ch2_out.extend(scope.scale_read_data(r2, vr2))
                except Exception as exc:
                    print(f"[Scope] Autoset read error: {exc}")
                    break
            return ch1_out, ch2_out

        # ── Step 1: capture at widest range to measure amplitude ──────────────
        scope.set_ch1_voltage_range(1)
        if nch >= 2:
            scope.set_ch2_voltage_range(1)
        time.sleep(0.02)                        # brief ADC settling
        ch1_wide, ch2_wide = _capture(1, 1, nblocks=3)

        if not ch1_wide:
            print("[Scope] Autoset: no data, aborting")
            with self._lock:
                self._running = True
            msg = json.dumps({"type": "autoset_done", "device": self.device_id, "error": "no_data"})
            self._latest = msg
            self._publish(msg)
            return

        # ── Step 2: choose best hardware voltage range per channel ───────────
        def _best_vr(samples: list) -> int:
            if not samples:
                return 1
            amplitude = max(abs(max(samples)), abs(min(samples)))
            for code in (10, 5, 2, 1):          # narrowest → widest
                if VR_FS[code] >= amplitude * 1.15:
                    return code
            return 1                             # widest as fallback

        vr1 = _best_vr(ch1_wide)
        vr2 = _best_vr(ch2_wide) if ch2_wide else 1

        # ── Step 3: apply chosen ranges and re-capture for accurate measurement
        scope.set_ch1_voltage_range(vr1)
        if nch >= 2:
            scope.set_ch2_voltage_range(vr2)
        with self._lock:
            self._ch1_vr = vr1
            self._ch2_vr = vr2
            self._ring1.clear()
            self._ring2.clear()
        time.sleep(0.02)
        ch1_final, ch2_final = _capture(vr1, vr2, nblocks=4)   # ~4×204 ms = ~820 ms

        # Fill ring so normal _build_frame works immediately on resume
        with self._lock:
            self._ring1.extend(ch1_final)
            if ch2_final:
                self._ring2.extend(ch2_final)

        # ── Step 4: frequency detection via rising midpoint crossings ─────────
        def _detect_freq(samples: list) -> float:
            if len(samples) < 20:
                return 0.0
            vmin, vmax = min(samples), max(samples)
            if (vmax - vmin) < 0.01:
                return 0.0              # DC / pure noise
            mid = (vmin + vmax) / 2
            crossings = sum(
                1 for i in range(1, len(samples))
                if samples[i - 1] < mid <= samples[i]
            )
            return crossings / (len(samples) / sr) if crossings else 0.0

        freq = _detect_freq(ch1_final if ch1_final else ch1_wide)

        # ── Step 5: trigger configuration ─────────────────────────────────────
        buf = ch1_final if ch1_final else ch1_wide
        vmin1, vmax1 = (min(buf), max(buf)) if buf else (0.0, 0.0)
        trig_level = round((vmin1 + vmax1) / 2, 4)

        with self._lock:
            self._trig_mode   = "AUTO"
            self._trig_source = "CH1"
            self._trig_edge   = "rising"
            self._trig_level  = trig_level
            self._single_done = False
            self._running     = True

        # ── Step 6: compute display V/div index that fills ~75 % of 8 rows ───
        def _best_vpd_idx(vpp: float) -> int:
            if vpp < 0.001:
                return 0
            target = vpp / (8 * 0.75)      # target V/div so trace uses 75 % height
            for i, v in enumerate(_VPDS):
                if v >= target:
                    return i
            return len(_VPDS) - 1

        ch1_vpp = (max(ch1_final) - min(ch1_final)) if ch1_final else 0.0
        ch2_vpp = (max(ch2_final) - min(ch2_final)) if ch2_final else 0.0

        ch1_vpd_idx = _best_vpd_idx(ch1_vpp)
        ch2_vpd_idx = _best_vpd_idx(ch2_vpp) if ch2_final else 9  # 1 V/div default

        # ── Broadcast result ──────────────────────────────────────────────────
        cfg = {
            "sample_rate":       sr,
            "time_span_ms":      round((FRAME_SAMPLES / sr) * 1000, 3),
            "num_channels":      nch,
            "ch1_voltage_range": vr1,
            "ch2_voltage_range": vr2,
        }
        display = {
            "ch1_volt_per_div_idx": ch1_vpd_idx,
            "ch2_volt_per_div_idx": ch2_vpd_idx,
            "trigger_source":       "CH1",
            "trigger_level":        trig_level,
            "trigger_mode":         "AUTO",
            "trigger_edge":         "rising",
        }
        msg = json.dumps({
            "type":    "autoset_done",
            "device":  self.device_id,
            "config":  cfg,
            "display": display,
        })
        self._latest = msg
        self._publish(msg)
        print(
            f"[Scope] Autoset done: CH1={VOLT_RANGES[vr1][1]} vpd_idx={ch1_vpd_idx}, "
            f"CH2={VOLT_RANGES[vr2][1]} vpd_idx={ch2_vpd_idx}, "
            f"freq={freq:.1f} Hz, trig={trig_level:.3f} V"
        )

    def _apply_pending(self, scope) -> None:
        """Apply any queued hardware reconfigurations. Call from scope thread only."""
        with self._lock:
            p = dict(self._pending)
            self._pending.clear()
        if not p:
            return

        print(f"[Scope] Applying config: {p}")

        if "sample_rate" in p:
            hz  = p["sample_rate"]
            sid = HZ_TO_ID.get(hz)
            if sid is not None:
                scope.set_sample_rate(sid)
                with self._lock:
                    self._sample_rate = hz
                print(f"[Scope] sample_rate → {hz}")

        if "num_channels" in p:
            n = p["num_channels"]
            scope.set_num_channels(n)
            with self._lock:
                self._num_channels = n
            print(f"[Scope] num_channels → {n}")

        if "ch1_vr" in p:
            vr = p["ch1_vr"]
            scope.set_ch1_voltage_range(vr)
            with self._lock:
                self._ch1_vr = vr
                self._ring1.clear()
            print(f"[Scope] ch1 range → {VOLT_RANGES[vr][1]}")

        if "ch2_vr" in p:
            vr = p["ch2_vr"]
            scope.set_ch2_voltage_range(vr)
            with self._lock:
                self._ch2_vr = vr
                self._ring2.clear()
            print(f"[Scope] ch2 range → {VOLT_RANGES[vr][1]}")

        # Echo updated config to clients as a config frame
        with self._lock:
            self._push_status("connected")

    def _read_loop(self, scope) -> None:
        """Inner blocking loop. Raises on hardware error."""
        while True:
            self._apply_pending(scope)

            # ── Autoset sequence ──────────────────────────────────────────────
            with self._lock:
                do_autoset = self._autoset_requested and not self._autoset_busy
                if do_autoset:
                    self._autoset_requested = False
                    self._autoset_busy = True

            if do_autoset:
                try:
                    self._run_autoset(scope)
                except Exception as exc:
                    print(f"[Scope] Autoset error: {exc}")
                    msg = json.dumps({
                        "type":   "autoset_done",
                        "device": self.device_id,
                        "error":  str(exc),
                    })
                    self._latest = msg
                    self._publish(msg)
                finally:
                    with self._lock:
                        self._autoset_busy = False
                        self._running = True    # always resume capture
                continue

            with self._lock:
                run = self._running
            if not run:
                time.sleep(0.05)
                continue

            try:
                ch1_raw, ch2_raw = scope.read_data(BLOCK_SIZE)
                ch1_v = list(scope.scale_read_data(ch1_raw, self._ch1_vr))
            except Exception as exc:
                raise exc

            with self._lock:
                self._ring1.extend(ch1_v)
                if self._num_channels >= 2 and ch2_raw:
                    try:
                        ch2_v = list(scope.scale_read_data(ch2_raw, self._ch2_vr))
                        self._ring2.extend(ch2_v)
                    except Exception:
                        pass

            self._build_frame()

    def _scope_thread(self) -> None:
        """Outer connection loop: connect → read → reconnect on any error."""
        while True:
            with self._lock:
                self._push_status("searching")

            print("[Scope] Looking for Hantek 6022BE…")
            scope = None
            try:
                from PyHT6022.LibUsbScope import Oscilloscope
                scope = Oscilloscope()
                scope.setup()
                if not scope.open_handle():
                    print("[Scope] Not found. Retrying in 3 s…")
                    time.sleep(3)
                    continue

                if not scope.is_device_firmware_present:
                    print("[Scope] Uploading firmware…")
                    scope.flash_firmware()
                    time.sleep(2)
                    scope.open_handle()

                scope.set_num_channels(self._num_channels)
                scope.set_sample_rate(HZ_TO_ID[self._sample_rate])
                scope.set_ch1_voltage_range(self._ch1_vr)
                if self._num_channels >= 2:
                    scope.set_ch2_voltage_range(self._ch2_vr)

                print("[Scope] Connected.")
                with self._lock:
                    self._push_status("connected")

                self._read_loop(scope)   # blocks until error

            except ImportError as exc:
                print(f"[Scope] Import error: {exc}")
                print("[Scope] Running as stub — install PyHT6022 + libusb for real capture.")
                print("[Scope] See README for one-time setup instructions.")
                with self._lock:
                    self._push_status("searching")
                time.sleep(10)   # retry periodically in case deps appear

            except Exception as exc:
                print(f"[Scope] Error: {exc}  — reconnecting in 2 s…")
                if scope:
                    try:
                        scope.close_handle()
                    except Exception:
                        pass
                time.sleep(2)


# ══════════════════════════════════════════════════════════════════════════════
# LADriver
# ══════════════════════════════════════════════════════════════════════════════

class LADriver:
    """FX2 Logic Analyzer driver via sigrok-cli subprocess."""

    def __init__(self, device_id: str, publish: Callable[[str], None]):
        self.device_id = device_id
        self._publish  = publish
        self._lock     = threading.Lock()

        self._la_status       = "searching"
        self._sample_rate     = 8_000_000
        self._enabled_channels = list(range(8))   # D0–D7
        self._running         = False

        # sigrok subprocess
        self._proc: subprocess.Popen | None = None
        self._latest: str | None = None

    # ── Public interface ───────────────────────────────────────────────────────

    @property
    def latest(self) -> str | None:
        return self._latest

    def get_info(self) -> dict:
        return {
            "id":     self.device_id,
            "kind":   "fx2-la",
            "label":  "FX2 Logic Analyzer 8CH",
            "status": self._la_status,
        }

    def start(self) -> None:
        t = threading.Thread(target=self._poll_thread, daemon=True)
        t.start()

    def apply_cmd(self, cmd: dict) -> None:
        c = cmd.get("cmd", "")
        with self._lock:
            if c == "run":
                self._running = True
            elif c == "stop":
                self._running = False
                self._kill_proc()
                self._la_status = "stopped"
            elif c == "set_sample_rate":
                val = int(cmd.get("value", self._sample_rate))
                if val in LA_SAMPLE_RATES:
                    self._sample_rate = val
                    # restart capture at new rate if currently running
                    if self._running:
                        self._kill_proc()
            elif c == "set_channels":
                enabled = cmd.get("enabled", list(range(8)))
                self._enabled_channels = [int(x) for x in enabled if 0 <= int(x) <= 7]
                if self._running:
                    self._kill_proc()

    # ── Internal helpers ───────────────────────────────────────────────────────

    def _kill_proc(self) -> None:
        """Kill the sigrok-cli subprocess if running. Must be called with lock held or safely."""
        proc = self._proc
        if proc is not None:
            try:
                proc.kill()
            except Exception:
                pass
            self._proc = None

    def _publish_error(self, message: str) -> None:
        msg = json.dumps({
            "type":    "error",
            "device":  self.device_id,
            "message": message,
        })
        self._latest = msg
        self._publish(msg)

    def _extract_transitions(
        self,
        chunk: bytes,
        prev_state: int,
        sample_offset: int,
        sample_rate: int,
        enabled_mask: int,
    ) -> tuple[dict[str, list[int]], int]:
        """
        Returns: { "D0": [ns_timestamps...], ... }, last_byte
        For each byte that differs from prev, find which bits changed.
        Record ns timestamp = (sample_offset + byte_index) / sample_rate * 1e9
        """
        transitions: dict[str, list[int]] = {f"D{i}": [] for i in range(8)}
        prev = prev_state
        for idx, byte in enumerate(chunk):
            byte = byte & enabled_mask
            if byte != prev:
                diff = byte ^ prev
                ns = int((sample_offset + idx) / sample_rate * 1_000_000_000)
                for bit in range(8):
                    if diff & (1 << bit):
                        transitions[f"D{bit}"].append(ns)
            prev = byte
        return transitions, prev

    def _stderr_monitor(self, proc: subprocess.Popen) -> None:
        """Watch sigrok-cli stderr for overflow/error keywords."""
        try:
            for line in proc.stderr:
                line = line.decode(errors="replace").strip()
                if line:
                    print(f"[LA] sigrok stderr: {line}")
                if "overflow" in line.lower():
                    self._publish_error(f"overflow: {line}")
                elif "error" in line.lower():
                    self._publish_error(f"error: {line}")
        except Exception:
            pass

    def _sigrok_available(self) -> bool:
        return shutil.which("sigrok-cli") is not None

    def _device_present(self) -> bool:
        """Check if fx2lafw device is detected by sigrok."""
        try:
            result = subprocess.run(
                ["sigrok-cli", "-d", "fx2lafw", "--show"],
                capture_output=True,
                timeout=5,
            )
            return result.returncode == 0
        except Exception:
            return False

    def _run_capture(self, sample_rate: int, enabled_channels: list) -> None:
        """Launch sigrok-cli and stream binary LA frames. Blocks until proc exits."""
        cmd = [
            "sigrok-cli",
            "-d", "fx2lafw",
            "-c", f"samplerate={sample_rate}",
            "-C", "D0,D1,D2,D3,D4,D5,D6,D7",
            "--continuous",
            "-O", "binary",
        ]
        print(f"[LA] Starting capture: {' '.join(cmd)}")

        with self._lock:
            self._la_status = "running"

        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        with self._lock:
            self._proc = proc

        # Start stderr monitor thread
        stderr_t = threading.Thread(target=self._stderr_monitor, args=(proc,), daemon=True)
        stderr_t.start()

        enabled_mask = 0
        for ch in enabled_channels:
            enabled_mask |= (1 << ch)

        samples_per_frame = int(FRAME_DURATION_S * sample_rate)
        frame_buf = bytearray()
        prev_state = 0
        sample_offset = 0
        frame_initial: dict[str, int] = {f"D{i}": 0 for i in range(8)}

        try:
            while True:
                # Check if we should stop
                with self._lock:
                    if not self._running or self._proc is not proc:
                        break

                chunk = proc.stdout.read(CHUNK_SIZE)
                if not chunk:
                    # subprocess exited
                    break

                frame_buf.extend(chunk)

                while len(frame_buf) >= samples_per_frame:
                    frame_bytes = bytes(frame_buf[:samples_per_frame])
                    frame_buf = frame_buf[samples_per_frame:]

                    transitions, last_byte = self._extract_transitions(
                        frame_bytes,
                        prev_state,
                        sample_offset,
                        sample_rate,
                        enabled_mask,
                    )

                    # Build channel dict
                    channels: dict[str, dict] = {}
                    for i in range(8):
                        ch_name = f"D{i}"
                        initial = (frame_initial[ch_name])
                        channels[ch_name] = {
                            "initial":     initial,
                            "transitions": transitions[ch_name],
                        }
                        # Update initial for next frame: last known state of this bit
                        channels[ch_name]["initial"] = (prev_state >> i) & 1

                    # Rebuild with correct initial values (state at frame start)
                    for i in range(8):
                        ch_name = f"D{i}"
                        channels[ch_name]["initial"] = (prev_state >> i) & 1

                    prev_state = last_byte
                    sample_offset += samples_per_frame

                    with self._lock:
                        enabled = list(self._enabled_channels)
                        sr_now  = self._sample_rate

                    # Filter to only enabled channels
                    out_channels: dict[str, dict] = {}
                    for i in enabled:
                        ch_name = f"D{i}"
                        out_channels[ch_name] = channels[ch_name]

                    time_span_ns = int(FRAME_DURATION_S * 1_000_000_000)
                    frame = {
                        "type":      "frame",
                        "device":    self.device_id,
                        "timestamp": int(time.time() * 1000),
                        "la_status": "running",
                        "config": {
                            "sample_rate":      sample_rate,
                            "enabled_channels": enabled,
                            "time_span_ns":     time_span_ns,
                        },
                        "channels": out_channels,
                        "overflow": False,
                    }
                    msg = json.dumps(frame)
                    self._latest = msg
                    self._publish(msg)

        except Exception as exc:
            print(f"[LA] Capture error: {exc}")
        finally:
            try:
                proc.kill()
            except Exception:
                pass
            with self._lock:
                if self._proc is proc:
                    self._proc = None
                if self._la_status == "running":
                    self._la_status = "stopped"
            print("[LA] Capture ended.")

    def _poll_thread(self) -> None:
        """Poll for device presence every 2 s; manage capture lifecycle."""
        while True:
            if not self._sigrok_available():
                print("[LA] sigrok-cli not found — logic analyzer support disabled.")
                with self._lock:
                    self._la_status = "searching"
                time.sleep(30)
                continue

            with self._lock:
                running = self._running
                proc    = self._proc

            if running and proc is None:
                # Try to start capture if device present
                if self._device_present():
                    with self._lock:
                        sr      = self._sample_rate
                        enabled = list(self._enabled_channels)
                    capture_t = threading.Thread(
                        target=self._run_capture,
                        args=(sr, enabled),
                        daemon=True,
                    )
                    capture_t.start()
                    # Give capture thread time to set self._proc
                    time.sleep(0.5)
                else:
                    with self._lock:
                        self._la_status = "searching"
                    time.sleep(2)
                    continue
            elif not running and proc is not None:
                with self._lock:
                    self._kill_proc()
                    self._la_status = "stopped"

            # Check if running proc has died
            with self._lock:
                proc = self._proc
            if proc is not None and proc.poll() is not None:
                with self._lock:
                    if self._proc is proc:
                        self._proc = None
                    self._la_status = "stopped"
                print("[LA] sigrok-cli process exited unexpectedly.")

            time.sleep(2)


# ══════════════════════════════════════════════════════════════════════════════
# DeviceManager
# ══════════════════════════════════════════════════════════════════════════════

class DeviceManager:
    def __init__(self):
        self._scope = ScopeDriver("scope-1", self._publish)
        self._la    = LADriver("la-1",    self._publish)
        self._latest: dict[str, str] = {}
        self._clients: set = set()
        self._clients_lock = threading.Lock()

    def _publish(self, json_str: str) -> None:
        """Store latest frame per device so WebSocket handler can poll it."""
        try:
            device_id = json.loads(json_str).get("device", "")
            self._latest[device_id] = json_str
        except Exception:
            pass

    def device_list(self) -> list[dict]:
        return [self._scope.get_info(), self._la.get_info()]

    def get_driver(self, device_id: str):
        return {"scope-1": self._scope, "la-1": self._la}.get(device_id)

    def start(self) -> None:
        self._scope.start()
        self._la.start()


# ── Singleton ──────────────────────────────────────────────────────────────────
manager = DeviceManager()


# ── WebSocket handler ──────────────────────────────────────────────────────────

async def _handler(websocket) -> None:
    addr = websocket.remote_address
    print(f"[WS] + {addr}")

    # Greet with device list
    try:
        await websocket.send(json.dumps({"type": "devices", "list": manager.device_list()}))
    except Exception:
        return

    # Receive commands in background task
    async def _recv():
        async for raw in websocket:
            try:
                msg = json.loads(raw)
                dev_id = msg.get("device", "scope-1")
                driver = manager.get_driver(dev_id)
                if driver:
                    driver.apply_cmd(msg)
            except Exception:
                pass

    recv_task = asyncio.create_task(_recv())
    sent: dict[str, str] = {}   # device_id → last sent str
    last_dev_list = None

    try:
        while True:
            # Broadcast device list if changed
            current_list = manager.device_list()
            if current_list != last_dev_list:
                await websocket.send(json.dumps({"type": "devices", "list": current_list}))
                last_dev_list = current_list

            # Send any new frames
            for dev_id, frame_str in list(manager._latest.items()):
                if frame_str is not sent.get(dev_id):
                    await websocket.send(frame_str)
                    sent[dev_id] = frame_str

            await asyncio.sleep(0.033)
    except Exception:
        pass
    finally:
        recv_task.cancel()
        print(f"[WS] - {addr}")


async def _main() -> None:
    manager.start()

    # Startup banner
    print("=" * 60)
    print("  HWBench Device Manager")
    print(f"  WebSocket: ws://{WS_HOST}:{WS_PORT}")
    print("=" * 60)
    for info in manager.device_list():
        print(f"  [{info['id']}]  {info['label']}  — status: {info['status']}")
    print("=" * 60)
    print("  Plug in instruments at any time — detected automatically.")
    print("  Ctrl+C to stop.\n")

    async with websockets.serve(_handler, WS_HOST, WS_PORT):
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(_main())
    except KeyboardInterrupt:
        print("\n[DevMgr] Stopped.")
