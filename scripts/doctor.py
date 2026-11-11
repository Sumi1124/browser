#!/usr/bin/env python3
"""Inspect effective build resources without downloading Chromium."""
import argparse
import json
import os
from pathlib import Path
import platform
import shutil

GIB = 1024 ** 3

def inspect(root, target=None):
    root = Path(root).resolve()
    disk_root = root
    while not disk_root.exists():
        disk_root = disk_root.parent
    memory = None
    try:
        memory = os.sysconf('SC_PHYS_PAGES') * os.sysconf('SC_PAGE_SIZE')
    except (ValueError, AttributeError):
        pass
    limit = Path('/sys/fs/cgroup/memory.max')
    if limit.exists() and limit.read_text().strip().isdigit():
        effective = int(limit.read_text())
        memory = min(memory, effective) if memory else effective
    cpu_limit = None
    try:
        quota, period = Path('/sys/fs/cgroup/cpu.max').read_text().split()
        if quota != 'max':
            cpu_limit = int(quota) / int(period)
    except (OSError, ValueError):
        pass
    free = shutil.disk_usage(disk_root).free
    system = platform.system()
    blockers = []
    existing = (root / 'src' / '.git').exists()
    minimum = 30 if existing else 100
    if free < minimum * GIB:
        blockers.append(f'{free / GIB:.1f} GiB free; at least {minimum} GiB needed for this checkout/build stage.')
    if memory is not None and memory < 8 * GIB:
        blockers.append('Less than 8 GiB effective memory.')
    if target == 'mac' and system != 'Darwin':
        blockers.append('macOS artifacts need a Mac with the pinned version\'s Xcode/SDK.')
    if target == 'win' and system != 'Windows':
        blockers.append('Windows artifacts need Windows with the pinned version\'s Visual Studio/SDK.')
    tools = {name: shutil.which(name) for name in ['git', 'python3', 'clang++', 'g++', 'cmake', 'ninja', 'gn', 'autoninja', 'fetch', 'gclient']}
    if not tools['git']:
        blockers.append('Git is required.')
    return {'system': system, 'architecture': platform.machine(), 'logical_cpus': os.cpu_count(),
            'cpu_quota': cpu_limit, 'effective_memory_gib': round(memory / GIB, 2) if memory else None,
            'free_disk_gib': round(free / GIB, 2), 'root': str(root), 'tools': tools,
            'blockers': blockers, 'recommendation': 'Dedicated native host: 32–64 GiB RAM, 300 GiB free SSD, 8+ CPU cores.'}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path.cwd() / 'work' / 'chromium')
    parser.add_argument('--target', choices=['linux', 'mac', 'win'])
    parser.add_argument('--require-build', action='store_true')
    args = parser.parse_args()
    report = inspect(args.root, args.target)
    print(json.dumps(report, indent=2))
    return 2 if args.require_build and report['blockers'] else 0

if __name__ == '__main__':
    raise SystemExit(main())
