#!/usr/bin/env python3
"""
HWBench scope server — Hantek 6022BE WebSocket bridge.

Handles hot-plug, bidirectional control, and software triggering.
Run:  python3 backend/scope_server.py
Deps: pip install websockets PyHT6022   (PyHT6022 needs libusb)

━━━ Protocol ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Server → Client (JSON):

  { "type": "status",
    "scope_status": "connected" | "searching",
    "config": { "sample_rate": 20000, "num_channels": 1,
                "ch1_voltage_range": 1, "ch2_voltage_range": 1 } }

  { "type": "hardware_update",
    "timestamp": <ms>,  "mode": "live",
    "scope_status": "connected" | "searching",
    "config": { "sample_rate": 20000, "time_span_ms": 50.0,
                "num_channels": 1, "ch1_voltage_range": 1, "ch2_voltage_range": 1 },
    "oscilloscope": {
      "ch1": { "samples": [...], "sample_rate": 20000, "time_span_ms": 50.0,
               "frequency": 0, "vpp": 0, "vmin": 0, "vmax": 0, "period": 0,
               "voltPerDiv": 1.25, "timePerDiv": 5.0 },
      "ch2": null | <same shape>
    },
    "protocol": { "newPackets": [] }
  }

Client → Server (JSON commands):

  { "cmd": "set_sample_rate",   "value": 20000 }
  { "cmd": "set_voltage_range", "channel": 1,  "value": 1 }
  { "cmd": "set_channels",      "value": 1 }
  { "cmd": "run" }
  { "cmd": "stop" }
  { "cmd": "set_trigger", "mode": "AUTO"|"NORM"|"SINGLE",
                          "source": "CH1"|"CH2",
                          "edge": "rising"|"falling",
                          "level": 0.0 }
  { "cmd": "autoset" }

Server → Client additional frame types (autoset):

  { "type": "autoset_start" }

  { "type": "autoset_done",
    "config":  { <same as hardware_update config> },
    "display": { "ch1_volt_per_div_idx": 8,
                 "ch2_volt_per_div_idx": 9,
                 "trigger_source": "CH1",
                 "trigger_level":  0.5,
                 "trigger_mode":   "AUTO",
                 "trigger_edge":   "rising" } }
"""
import asyncio
import json
import threading
import time
from collections import deque

import websockets

# ── Server config ─────────────────────────────────────────────────────────────
WS_HOST      = "localhost"
WS_PORT      = 5001
SEND_INTERVAL = 0.033     # ~30 fps push to clients
FRAME_SAMPLES = 1000      # downsample target for the UI
BLOCK_SIZE    = 0x1000    # 4096 raw samples per USB read
RING_SAMPLES  = 8000      # ring buffer depth

# Hantek 6022BE sample rates: scope_id → (actual_hz, label)
# IDs are specific to PyHT6022 — verified via scope_view.py test.
# Add more entries as you calibrate additional rates.
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


# ── Shared state ───────────────────────────────────────────────────────────────

class _State:
    def __init__(self):
        self.lock              = threading.Lock()
        self.scope_status      = "searching"
        self.running           = True
        self.sample_rate       = 20_000
        self.num_channels      = 1
        self.ch1_vr            = 1
        self.ch2_vr            = 1
        self.trig_mode         = "AUTO"
        self.trig_source       = "CH1"
        self.trig_edge         = "rising"
        self.trig_level        = 0.0
        self.single_done       = False
        self.ring1: deque      = deque(maxlen=RING_SAMPLES)
        self.ring2: deque      = deque(maxlen=RING_SAMPLES)
        self.pending: dict     = {}
        self.autoset_requested = False
        self.autoset_busy      = False
        # Latest JSON string broadcast to every connected client
        self.latest: str | None = None


S = _State()


def _config_dict() -> dict:
    return {
        "sample_rate":       S.sample_rate,
        "num_channels":      S.num_channels,
        "ch1_voltage_range": S.ch1_vr,
        "ch2_voltage_range": S.ch2_vr,
    }


def _push_status(status: str) -> None:
    """Update scope_status and store a status frame as the latest broadcast."""
    S.scope_status = status
    S.latest = json.dumps({
        "type":         "status",
        "scope_status": status,
        "config":       _config_dict(),
    })


# ── Scope thread helpers ───────────────────────────────────────────────────────

def _ch_dict(samples: list, sample_rate: int, vr: int) -> dict:
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


def _find_trig(buf: list, level: float, edge: str, start: int, end: int) -> int:
    """Return index of first trigger crossing, or -1."""
    for i in range(start + 1, min(end, len(buf))):
        p, c = buf[i - 1], buf[i]
        if edge == "rising"  and p < level <= c: return i - 1
        if edge == "falling" and p > level >= c: return i - 1
    return -1


def _downsample(arr: list) -> list:
    if len(arr) <= FRAME_SAMPLES:
        return arr
    step = max(1, len(arr) // FRAME_SAMPLES)
    return arr[::step][:FRAME_SAMPLES]


def _build_frame() -> None:
    """Build trigger-aligned frame from ring buffer and store in S.latest."""
    with S.lock:
        r1   = list(S.ring1)
        r2   = list(S.ring2)
        sr   = S.sample_rate
        vr1  = S.ch1_vr
        vr2  = S.ch2_vr
        nch  = S.num_channels
        mode = S.trig_mode
        src  = S.trig_source
        edge = S.trig_edge
        lvl  = S.trig_level
        done = S.single_done
        run  = S.running

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
        t = _find_trig(ring_src, lvl, edge, guard, len(ring_src) - FRAME_SAMPLES)
        if t == -1:
            return   # no trigger — hold last frame
        ch1w = r1[t: t + FRAME_SAMPLES]
        ch2w = r2[t: t + FRAME_SAMPLES] if (nch >= 2 and t + FRAME_SAMPLES <= len(r2)) else None
        if mode == "SINGLE":
            with S.lock:
                S.single_done = True
                S.running = False

    time_span_ms = round((FRAME_SAMPLES / sr) * 1000, 3)
    frame = {
        "type":         "hardware_update",
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
            "ch1": _ch_dict(_downsample(ch1w), sr, vr1),
            "ch2": _ch_dict(_downsample(ch2w), sr, vr2) if ch2w else None,
        },
        "protocol": {"newPackets": []},
    }
    S.latest = json.dumps(frame)


# Display V/div values — must match frontend VOLT_PER_DIV constant.
_VPDS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0]


def _run_autoset(scope) -> None:
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
    S.latest = json.dumps({"type": "autoset_start"})

    nch   = S.num_channels
    sr    = S.sample_rate
    VR_FS = {1: 5.0, 2: 2.5, 5: 1.0, 10: 0.5}   # code → one-sided full-scale V

    # ── Helper: read nblocks directly from hardware ───────────────────────────
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

    # ── Step 1: capture at widest range to measure amplitude ─────────────────
    scope.set_ch1_voltage_range(1)
    if nch >= 2:
        scope.set_ch2_voltage_range(1)
    time.sleep(0.02)                        # brief ADC settling
    ch1_wide, ch2_wide = _capture(1, 1, nblocks=3)

    if not ch1_wide:
        print("[Scope] Autoset: no data, aborting")
        with S.lock:
            S.running = True
        S.latest = json.dumps({"type": "autoset_done", "error": "no_data"})
        return

    # ── Step 2: choose best hardware voltage range per channel ───────────────
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

    # ── Step 3: apply chosen ranges and re-capture for accurate measurement ──
    scope.set_ch1_voltage_range(vr1)
    if nch >= 2:
        scope.set_ch2_voltage_range(vr2)
    with S.lock:
        S.ch1_vr = vr1
        S.ch2_vr = vr2
        S.ring1.clear()
        S.ring2.clear()
    time.sleep(0.02)
    ch1_final, ch2_final = _capture(vr1, vr2, nblocks=4)   # ~4×204 ms = ~820 ms

    # Fill ring so normal _build_frame works immediately on resume
    with S.lock:
        S.ring1.extend(ch1_final)
        if ch2_final:
            S.ring2.extend(ch2_final)

    # ── Step 4: frequency detection via rising midpoint crossings ────────────
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

    # ── Step 5: trigger configuration ────────────────────────────────────────
    buf = ch1_final if ch1_final else ch1_wide
    vmin1, vmax1 = (min(buf), max(buf)) if buf else (0.0, 0.0)
    trig_level = round((vmin1 + vmax1) / 2, 4)

    with S.lock:
        S.trig_mode   = "AUTO"
        S.trig_source = "CH1"
        S.trig_edge   = "rising"
        S.trig_level  = trig_level
        S.single_done = False
        S.running     = True

    # ── Step 6: compute display V/div index that fills ~75 % of 8 rows ───────
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

    # ── Broadcast result ──────────────────────────────────────────────────────
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
    S.latest = json.dumps({"type": "autoset_done", "config": cfg, "display": display})
    print(
        f"[Scope] Autoset done: CH1={VOLT_RANGES[vr1][1]} vpd_idx={ch1_vpd_idx}, "
        f"CH2={VOLT_RANGES[vr2][1]} vpd_idx={ch2_vpd_idx}, "
        f"freq={freq:.1f} Hz, trig={trig_level:.3f} V"
    )


def _apply_pending(scope) -> None:
    """Apply any queued hardware reconfigurations. Call from scope thread only."""
    with S.lock:
        p = dict(S.pending)
        S.pending.clear()
    if not p:
        return

    print(f"[Scope] Applying config: {p}")

    if "sample_rate" in p:
        hz  = p["sample_rate"]
        sid = HZ_TO_ID.get(hz)
        if sid is not None:
            scope.set_sample_rate(sid)
            with S.lock:
                S.sample_rate = hz
            print(f"[Scope] sample_rate → {hz}")

    if "num_channels" in p:
        n = p["num_channels"]
        scope.set_num_channels(n)
        with S.lock:
            S.num_channels = n
        print(f"[Scope] num_channels → {n}")

    if "ch1_vr" in p:
        vr = p["ch1_vr"]
        scope.set_ch1_voltage_range(vr)
        with S.lock:
            S.ch1_vr = vr
            S.ring1.clear()
        print(f"[Scope] ch1 range → {VOLT_RANGES[vr][1]}")

    if "ch2_vr" in p:
        vr = p["ch2_vr"]
        scope.set_ch2_voltage_range(vr)
        with S.lock:
            S.ch2_vr = vr
            S.ring2.clear()
        print(f"[Scope] ch2 range → {VOLT_RANGES[vr][1]}")

    # Echo updated config to clients as a status frame
    with S.lock:
        _push_status("connected")


def _read_loop(scope) -> None:
    """Inner blocking loop. Raises on hardware error."""
    while True:
        _apply_pending(scope)

        # ── Autoset sequence ──────────────────────────────────────────────────
        with S.lock:
            do_autoset = S.autoset_requested and not S.autoset_busy
            if do_autoset:
                S.autoset_requested = False
                S.autoset_busy = True

        if do_autoset:
            try:
                _run_autoset(scope)
            except Exception as exc:
                print(f"[Scope] Autoset error: {exc}")
                S.latest = json.dumps({"type": "autoset_done", "error": str(exc)})
            finally:
                with S.lock:
                    S.autoset_busy = False
                    S.running = True    # always resume capture
            continue

        with S.lock:
            run = S.running
        if not run:
            time.sleep(0.05)
            continue

        ch1_raw, ch2_raw = scope.read_data(BLOCK_SIZE)
        ch1_v = list(scope.scale_read_data(ch1_raw, S.ch1_vr))

        with S.lock:
            S.ring1.extend(ch1_v)
            if S.num_channels >= 2 and ch2_raw:
                ch2_v = list(scope.scale_read_data(ch2_raw, S.ch2_vr))
                S.ring2.extend(ch2_v)

        _build_frame()


def _scope_thread() -> None:
    """Outer connection loop: connect → read → reconnect on any error."""
    while True:
        with S.lock:
            _push_status("searching")

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

            scope.set_num_channels(S.num_channels)
            scope.set_sample_rate(HZ_TO_ID[S.sample_rate])
            scope.set_ch1_voltage_range(S.ch1_vr)
            if S.num_channels >= 2:
                scope.set_ch2_voltage_range(S.ch2_vr)

            print("[Scope] Connected.")
            with S.lock:
                _push_status("connected")

            _read_loop(scope)   # blocks until error

        except ImportError as exc:
            print(f"[Scope] Import error: {exc}")
            print("[Scope] Running as stub — install PyHT6022 + libusb for real capture.")
            print("[Scope] See README for one-time setup instructions.")
            with S.lock:
                _push_status("searching")
            time.sleep(10)   # retry periodically in case deps appear

        except Exception as exc:
            print(f"[Scope] Error: {exc}  — reconnecting in 2 s…")
            if scope:
                try:
                    scope.close_handle()
                except Exception:
                    pass
            time.sleep(2)


# ── Control message handler ────────────────────────────────────────────────────

def _apply_cmd(cmd: dict) -> None:
    c = cmd.get("cmd", "")
    with S.lock:
        if c == "run":
            S.running = True
            S.single_done = False
        elif c == "stop":
            S.running = False
        elif c == "set_sample_rate":
            hz = int(cmd.get("value", S.sample_rate))
            if hz in HZ_TO_ID:
                S.pending["sample_rate"] = hz
        elif c == "set_voltage_range":
            ch = int(cmd.get("channel", 1))
            vr = int(cmd.get("value", 1))
            if vr in VOLT_RANGES:
                S.pending[f"ch{ch}_vr"] = vr
        elif c == "set_channels":
            n = int(cmd.get("value", 1))
            if n in (1, 2):
                S.pending["num_channels"] = n
        elif c == "set_trigger":
            S.trig_mode   = cmd.get("mode",   S.trig_mode)
            S.trig_source = cmd.get("source", S.trig_source)
            S.trig_edge   = cmd.get("edge",   S.trig_edge)
            S.trig_level  = float(cmd.get("level", S.trig_level))
            S.single_done = False   # re-arm SINGLE
        elif c == "autoset":
            if not S.autoset_busy:
                S.autoset_requested = True


# ── WebSocket server ───────────────────────────────────────────────────────────

async def _handler(websocket) -> None:
    addr = websocket.remote_address
    print(f"[WS] + {addr}")

    # Greet new client with current status
    with S.lock:
        hello = json.dumps({
            "type":         "status",
            "scope_status": S.scope_status,
            "config":       _config_dict(),
        })
    try:
        await websocket.send(hello)
    except Exception:
        return

    # Receive control messages in a background task
    async def _recv():
        async for raw in websocket:
            try:
                _apply_cmd(json.loads(raw))
            except Exception:
                pass

    recv_task = asyncio.create_task(_recv())
    last_sent = None

    try:
        while True:
            msg = S.latest
            if msg is not None and msg is not last_sent:
                try:
                    await websocket.send(msg)
                    last_sent = msg
                except Exception:
                    break
            await asyncio.sleep(SEND_INTERVAL)
    finally:
        recv_task.cancel()
        print(f"[WS] - {addr}")


async def _main() -> None:
    t = threading.Thread(target=_scope_thread, daemon=True)
    t.start()

    print(f"[WS] ws://{WS_HOST}:{WS_PORT}")
    print("     Plug in the Hantek 6022BE at any time — detected automatically.")
    print("     Ctrl+C to stop.\n")

    async with websockets.serve(_handler, WS_HOST, WS_PORT):
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(_main())
    except KeyboardInterrupt:
        print("\n[Scope] Stopped.")
