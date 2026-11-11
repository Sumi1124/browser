#!/usr/bin/env python3
"""Build the actual Chromium browser and Aster tests; never substitutes a shell."""
import argparse
import os
from pathlib import Path
import platform
import shutil
import subprocess
from apply_overlay import apply

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--src', type=Path, required=True)
    parser.add_argument('--depot-tools', type=Path, required=True)
    parser.add_argument('--cpu', choices=['arm64', 'x64'], required=True)
    parser.add_argument('--jobs', type=int, default=4)
    parser.add_argument('--run-tests', action='store_true')
    args = parser.parse_args()
    if args.jobs < 1:
        parser.error('--jobs must be positive')
    src = args.src.resolve()
    apply(src, check=True)
    if not (src / '.aster-overlay.json').is_file():
        parser.error('Install the overlay first (apply_overlay.py without --check).')
    env = os.environ.copy()
    env['PATH'] = str(args.depot_tools.resolve()) + os.pathsep + env['PATH']
    env['DEPOT_TOOLS_WIN_TOOLCHAIN'] = '0'
    def run(command):
        subprocess.run([str(x) for x in command], cwd=src, env=env, check=True)
    def tool(name):
        path = shutil.which(name, path=env['PATH'])
        if not path:
            raise RuntimeError(name + ' unavailable in depot_tools')
        return path
    gn_args = f'target_cpu="{args.cpu}" is_debug=false is_component_build=false symbol_level=1 is_chrome_branded=false use_remoteexec=false dcheck_always_on=true'
    run([tool('gn'), 'gen', 'out/Aster', '--check', '--args=' + gn_args])
    run([tool('autoninja'), '-C', 'out/Aster', '-j', args.jobs, 'chrome', 'aster:aster_core_tests', 'browser_tests'])
    if args.run_tests:
        suffix = '.exe' if platform.system() == 'Windows' else ''
        run([src / 'out/Aster' / ('aster_core_tests' + suffix)])
        command = [src / 'out/Aster' / ('browser_tests' + suffix), '--gtest_filter=AsterSplitSearchBrowserTest.*', '--test-launcher-jobs=1']
        if platform.system() == 'Linux' and not env.get('DISPLAY'):
            command = ['python3', src / 'testing/xvfb.py'] + command
        run(command)
    print('Native build commands completed. Packaging and installer identity validation are separate release steps.')

if __name__ == '__main__':
    main()
