#!/usr/bin/env python3
"""Official depot_tools checkout, pinned by Chromium commit, on a build host."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from doctor import inspect

ROOT = Path(__file__).resolve().parents[1]

def run(args, cwd, env):
    subprocess.run([str(arg) for arg in args], cwd=cwd, env=env, check=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True, help='Dedicated checkout/cache directory, outside this repository')
    parser.add_argument('--depot-tools', type=Path, help='Existing official depot_tools checkout')
    args = parser.parse_args()
    checkout = args.root.resolve()
    if checkout == ROOT or ROOT in checkout.parents:
        parser.error('Use a dedicated Chromium checkout outside the Aster repository.')
    report = inspect(checkout)
    if report['blockers']:
        print('\n'.join(report['blockers']), file=sys.stderr)
        return 2
    checkout.mkdir(parents=True, exist_ok=True)
    depot = args.depot_tools.resolve() if args.depot_tools else checkout / 'depot_tools'
    env = os.environ.copy()
    env['PATH'] = str(depot) + os.pathsep + env['PATH']
    env['DEPOT_TOOLS_WIN_TOOLCHAIN'] = '0'
    if not depot.exists():
        run(['git', 'clone', 'https://chromium.googlesource.com/chromium/tools/depot_tools.git', depot], checkout, env)
    if not (depot / 'fetch.py').is_file():
        raise RuntimeError('Not a depot_tools checkout: ' + str(depot))
    def tool(name):
        result = shutil.which(name, path=env['PATH'])
        if not result:
            raise RuntimeError(f'{name} is unavailable; complete official depot_tools platform setup.')
        return result
    src = checkout / 'src'
    if not src.exists():
        run([tool('fetch'), '--nohooks', '--no-history', 'chromium'], checkout, env)
    # Never overwrite an existing developer's patches or untracked files.
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=src, text=True).strip():
        raise RuntimeError('Chromium checkout is dirty. Use a clean checkout for this pinned overlay.')
    pin = json.loads((ROOT / 'chromium/version.json').read_text())
    run(['git', 'fetch', '--depth=1', 'origin', 'refs/tags/' + pin['version']], src, env)
    revision = subprocess.check_output(['git', 'rev-parse', 'FETCH_HEAD'], cwd=src, text=True).strip()
    if revision != pin['revision']:
        raise RuntimeError('Upstream tag does not match the reviewed commit pin.')
    run(['git', 'checkout', '--detach', pin['revision']], src, env)
    run([tool('gclient'), 'sync', '-D', '--nohooks', '--with_branch_heads', '--with_tags'], src, env)
    # Install native system dependencies first, following the pinned docs.
    run([tool('gclient'), 'runhooks'], src, env)
    print(f'Pinned checkout ready: {src}\nNext: python scripts/apply_overlay.py --src "{src}"')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
