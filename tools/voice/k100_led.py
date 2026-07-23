#!/usr/bin/env python3
"""
K100 RGB LED control via BRAGI protocol over HID.

Sets individual key colors on the Corsair K100 without needing
iCUE, ckb-next, or OpenRGB. Talks directly to the keyboard
over USB HID.

Usage:
    python k100_led.py blue     # set G1 to blue
    python k100_led.py white    # set G1 to white (default)
    python k100_led.py off      # release to hardware lighting
"""

import sys
import time

try:
    import hid
except ImportError:
    print("Install hidapi: pip install hidapi", file=sys.stderr)
    sys.exit(1)

# Corsair K100 RGB Optical-Mechanical
VID = 0x1B1C
PID = 0x1BC5

# BRAGI protocol constants
BRAGI_MAGIC = 0x08
BRAGI_SET = 0x01
BRAGI_CLOSE_HANDLE = 0x05
BRAGI_WRITE_DATA = 0x06
BRAGI_CONTINUE_WRITE = 0x07
BRAGI_OPEN_HANDLE = 0x0D

BRAGI_MODE = 0x03
BRAGI_MODE_HW = 0x01
BRAGI_MODE_SW = 0x02

BRAGI_LIGHTING_HANDLE = 0x00
BRAGI_RES_ALT_LIGHTING = 0x22

# K100 has 193 LED zones in ckb-next BRAGI layout
NUM_ZONES = 193

# G-key zone indices (K100 BRAGI layout)
# These will be calibrated on first run
G_KEYS = {
    "g1": 131,
    "g2": 132,
    "g3": 133,
    "g4": 134,
    "g5": 135,
    "g6": 136,
}


def find_k100():
    """Find K100 command interface (FF42:0001)."""
    for d in hid.enumerate(VID, PID):
        if d["usage_page"] == 0xFF42 and d["usage"] == 0x0001:
            return d["path"]
    # Try any Corsair keyboard with same interface
    for d in hid.enumerate(VID):
        if d["usage_page"] == 0xFF42 and d["usage"] == 0x0001:
            return d["path"]
    return None


class K100:
    def __init__(self):
        path = find_k100()
        if not path:
            raise RuntimeError("K100 not found")
        self.dev = hid.device()
        self.dev.open_path(path)
        self.dev.set_nonblocking(0)

    def _send(self, data_bytes):
        """Send 65-byte output report (report ID 0x00 + 64 data)."""
        pkt = bytearray(65)
        pkt[0] = 0x00  # report ID
        for i, b in enumerate(data_bytes):
            if i < 64:
                pkt[1 + i] = b
        self.dev.write(bytes(pkt))
        return list(self.dev.read(64))

    def set_mode(self, mode):
        """Set device mode (HW=1, SW=2)."""
        r = self._send([BRAGI_MAGIC, BRAGI_SET, BRAGI_MODE, 0x00, mode & 0xFF, 0x00])
        return r[2] == 0 if len(r) > 2 else False

    def open_lighting(self):
        """Open ALT_LIGHTING on handle 0."""
        r = self._send([BRAGI_MAGIC, BRAGI_OPEN_HANDLE, BRAGI_LIGHTING_HANDLE,
                        BRAGI_RES_ALT_LIGHTING, 0x00, 0x00])
        return r[2] == 0 if len(r) > 2 else False

    def close_lighting(self):
        """Close lighting handle."""
        self._send([BRAGI_MAGIC, BRAGI_CLOSE_HANDLE, 0x01, BRAGI_LIGHTING_HANDLE, 0x00])

    def write_leds(self, rgb_per_zone):
        """Write LED data. rgb_per_zone: list of (R,G,B) tuples, one per zone."""
        # Build LED payload: [0x12, 0x00] + interleaved RGB
        payload = bytearray(2 + NUM_ZONES * 3)
        payload[0] = 0x12  # direct mode marker
        payload[1] = 0x00
        for i, (r, g, b) in enumerate(rgb_per_zone):
            if i >= NUM_ZONES:
                break
            payload[2 + i * 3] = r & 0xFF
            payload[2 + i * 3 + 1] = g & 0xFF
            payload[2 + i * 3 + 2] = b & 0xFF

        total = len(payload)

        # First transport packet: 7-byte header + data
        pkt = bytearray(64)
        pkt[0] = BRAGI_MAGIC
        pkt[1] = BRAGI_WRITE_DATA
        pkt[2] = BRAGI_LIGHTING_HANDLE
        pkt[3] = total & 0xFF
        pkt[4] = (total >> 8) & 0xFF
        pkt[5] = 0
        pkt[6] = 0
        first_chunk = min(57, total)
        pkt[7:7 + first_chunk] = payload[:first_chunk]
        self._send(list(pkt))

        # Continuation packets: 3-byte header + data
        offset = first_chunk
        while offset < total:
            pkt = bytearray(64)
            pkt[0] = BRAGI_MAGIC
            pkt[1] = BRAGI_CONTINUE_WRITE
            pkt[2] = BRAGI_LIGHTING_HANDLE
            chunk = min(61, total - offset)
            pkt[3:3 + chunk] = payload[offset:offset + chunk]
            offset += chunk
            self._send(list(pkt))

    def close(self):
        self.dev.close()


def set_g1_color(r, g, b):
    """Set G1 key to specified RGB color. All other keys stay at current hardware state."""
    kb = K100()
    try:
        # Switch to software mode
        if not kb.set_mode(BRAGI_MODE_SW):
            print("Failed to set software mode", file=sys.stderr)
            return False

        # Open lighting handle
        if not kb.open_lighting():
            print("Failed to open lighting", file=sys.stderr)
            return False

        # Build zone colors: all white, G1 = specified color
        zones = [(0xFF, 0xFF, 0xFF)] * NUM_ZONES
        g1_idx = G_KEYS["g1"]
        if g1_idx < NUM_ZONES:
            zones[g1_idx] = (r, g, b)

        kb.write_leds(zones)
        return True
    finally:
        kb.close()


def release_to_hardware():
    """Release keyboard back to hardware lighting mode."""
    kb = K100()
    try:
        kb.close_lighting()
        kb.set_mode(BRAGI_MODE_HW)
    finally:
        kb.close()


def set_all_color(r, g, b):
    """Set ALL keys to one color (for testing)."""
    kb = K100()
    try:
        kb.set_mode(BRAGI_MODE_SW)
        kb.open_lighting()
        zones = [(r, g, b)] * NUM_ZONES
        kb.write_leds(zones)
        return True
    finally:
        kb.close()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "blue"

    if cmd == "blue":
        print("Setting G1 → blue")
        set_g1_color(0x00, 0x00, 0xFF)
    elif cmd == "white":
        print("Setting G1 → white")
        set_g1_color(0xFF, 0xFF, 0xFF)
    elif cmd == "off":
        print("Releasing to hardware mode")
        release_to_hardware()
    elif cmd == "test-red":
        print("ALL keys → red (test)")
        set_all_color(0xFF, 0x00, 0x00)
    elif cmd == "test-blue":
        print("ALL keys → blue (test)")
        set_all_color(0x00, 0x00, 0xFF)
    else:
        print(f"Unknown command: {cmd}")
        print("Usage: k100_led.py [blue|white|off|test-red|test-blue]")
        sys.exit(1)
