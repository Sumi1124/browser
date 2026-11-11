#!/usr/bin/env python3
"""Native CI entry point for a dedicated, trusted, pre-provisioned build host."""
import os
from pathlib import Path
import subprocess
import sys
ROOT = Path(__file__).resolve().parents[1]
checkout = Path(os.environ['ASTER_CHROMIUM_ROOT']).resolve()
cpu = os.environ['ASTER_TARGET_CPU']
if not (checkout / 'src/.aster-overlay.json').exists():
    subprocess.run([sys.executable, str(ROOT / 'scripts/bootstrap.py'), '--root', str(checkout)], check=True)
subprocess.run([sys.executable, str(ROOT / 'scripts/apply_overlay.py'), '--src', str(checkout / 'src')], check=True)
subprocess.run([sys.executable, str(ROOT / 'scripts/build.py'), '--src', str(checkout / 'src'),
                '--depot-tools', str(checkout / 'depot_tools'), '--cpu', cpu, '--run-tests'], check=True)
