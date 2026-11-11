#!/usr/bin/env python3
"""Verify patch applicability using only pinned upstream source files, not a build."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import urllib.request
from apply_overlay import ROOT, PATCH, source_checks

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--snapshot', type=Path, help='Use previously downloaded pinned files')
    args = parser.parse_args()
    pin = json.loads((ROOT / 'chromium/version.json').read_text())
    paths = json.loads((ROOT / 'chromium/upstream_files.json').read_text())
    work = ROOT / 'work'
    work.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='patch-check-', dir=work) as temporary:
        root = Path(temporary)
        for path in paths:
            data = (args.snapshot / path).read_bytes() if args.snapshot else urllib.request.urlopen(
                f'https://raw.githubusercontent.com/chromium/chromium/{pin["revision"]}/{path}', timeout=30).read()
            target = root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        source_checks(root)
        subprocess.run(['git', 'init', '--quiet'], cwd=root, check=True)
        subprocess.run(['git', 'apply', '--check', str(PATCH)], cwd=root, check=True)
        subprocess.run(['git', 'apply', str(PATCH)], cwd=root, check=True)
        subprocess.run(['git', 'apply', '--reverse', '--check', str(PATCH)], cwd=root, check=True)
        subprocess.run(['git', 'apply', '--reverse', str(PATCH)], cwd=root, check=True)
        source_checks(root)
        print(f'Patch applies and reverses exactly on {len(paths)} pinned source files. This is not a Chromium compilation.')

if __name__ == '__main__':
    main()
