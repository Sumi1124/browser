#!/usr/bin/env python3
"""Fail if the reviewed Chromium pin differs from Google's current stable feed."""
import json
from pathlib import Path
import urllib.request
ROOT = Path(__file__).resolve().parents[1]
def main():
    pin = json.loads((ROOT / 'chromium/version.json').read_text())
    with urllib.request.urlopen(pin['stable_feed'], timeout=30) as response:
        current = json.load(response)['channels']['Stable']['version']
    print(f'Reviewed pin: {pin["version"]}; current stable: {current}')
    if current != pin['version']:
        print('Review the security update, refresh the pin/patch, and validate native builds before release.')
        return 1
    return 0
if __name__ == '__main__': raise SystemExit(main())
