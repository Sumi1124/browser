#!/usr/bin/env python3
"""Fail-closed, idempotent overlay installation into a pinned Chromium checkout."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PATCH = ROOT / 'chromium/patches/0001-aster-productivity.patch'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def overlay_files():
    result = {}
    for source in (ROOT / 'aster').rglob('*'):
        if source.is_file():
            result['aster/' + source.relative_to(ROOT / 'aster').as_posix()] = source
    result['aster/LICENSE'] = ROOT / 'LICENSE'
    for source in (ROOT / 'chromium/overlay').rglob('*'):
        if source.is_file():
            result[source.relative_to(ROOT / 'chromium/overlay').as_posix()] = source
    return result

def source_checks(src):
    expected = json.loads((ROOT / 'chromium/upstream_files.json').read_text())
    for relative, sha in expected.items():
        path = src / relative
        if not path.resolve().is_relative_to(src) or not path.is_file() or path.is_symlink() or digest(path.read_bytes()) != sha:
            raise RuntimeError('Pinned source mismatch; refusing to overwrite: ' + relative)
    return expected

def apply(src, check=False):
    pin = json.loads((ROOT / 'chromium/version.json').read_text())
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=src, text=True).strip()
    if head != pin['revision']:
        raise RuntimeError('Checkout HEAD does not match chromium/version.json.')
    files = overlay_files()
    manifest_path = src / '.aster-overlay.json'
    source_digest = digest(PATCH.read_bytes() + b''.join((name + digest(path.read_bytes())).encode() for name, path in sorted(files.items())))
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        if manifest.get('source_digest') != source_digest:
            raise RuntimeError('Different overlay installed. Use a clean pinned checkout to upgrade.')
        for name, sha in manifest['installed'].items():
            if digest((src / name).read_bytes()) != sha:
                raise RuntimeError('Installed overlay was edited; refusing to overwrite: ' + name)
        print('Exact overlay already installed and verified.')
        return
    expected = source_checks(src)
    for name in files:
        target = src / name
        if not target.resolve().is_relative_to(src) or target.exists() or target.is_symlink():
            raise RuntimeError('Unowned destination already exists: ' + name)
    subprocess.run(['git', 'apply', '--check', str(PATCH)], cwd=src, check=True)
    if check:
        print('Pinned revision, source hashes, patch and destinations verified. No changes made.')
        return
    subprocess.run(['git', 'apply', str(PATCH)], cwd=src, check=True)
    for name, source in files.items():
        target = src / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    installed = {name: digest((src / name).read_bytes()) for name in list(expected) + list(files)}
    manifest_path.write_text(json.dumps({'source_digest': source_digest, 'installed': installed}, indent=2) + '\n')
    print('Aster overlay installed. Run GN generation, gn check and native tests before use.')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--src', type=Path, required=True)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    apply(args.src.resolve(), args.check)

if __name__ == '__main__':
    main()
