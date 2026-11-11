#!/usr/bin/env python3
"""Dependency-free local C++ check. For MSVC use CMake/CTest."""
import argparse
import os
from pathlib import Path
import shlex
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sanitize', action='store_true')
    args = parser.parse_args()
    output = ROOT / 'work' / 'build'
    output.mkdir(parents=True, exist_ok=True)
    command = shlex.split(os.environ.get('CXX', 'c++')) + [
        '-std=c++20', '-Wall', '-Wextra', '-Wpedantic', '-Werror', '-fno-exceptions',
        '-g', '-O1', '-I', str(ROOT)]
    if args.sanitize:
        command += ['-fsanitize=address,undefined', '-fno-omit-frame-pointer']
    binary = output / ('aster_core_tests_sanitized' if args.sanitize else 'aster_core_tests')
    command += [str(ROOT / file) for file in [
        'aster/core/search.cc', 'aster/core/workspace.cc', 'aster/tests/core_test.cc']]
    subprocess.run(command + ['-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)

if __name__ == '__main__':
    main()
