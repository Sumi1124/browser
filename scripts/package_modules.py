#!/usr/bin/env python3
"""Build the downloadable modules zip (JavaScript modules, tests, example, docs).

The archive is reproducible: files are added in sorted order with a fixed
timestamp, so the same commit always produces the same bytes.
"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MODULE_DIRS = ['common', 'research', 'study', 'data', 'ai', 'storage']
# Browser tests need Playwright and files outside the package, so they stay out.
def is_packaged_test(path):
    return not path.name.endswith('.browser.test.mjs')
FIXED_TIME = (2026, 1, 1, 0, 0, 0)


def package_files():
    files = {
        'README.md': ROOT / 'packaging/README.md',
        'API.md': ROOT / 'docs/API.md',
        'LICENSE': ROOT / 'LICENSE',
        'examples/quickstart.mjs': ROOT / 'examples/quickstart.mjs',
    }
    for name in MODULE_DIRS:
        for path in sorted((ROOT / 'aster' / name).glob('*.mjs')):
            files[path.relative_to(ROOT).as_posix()] = path
    for path in sorted((ROOT / 'tests').glob('*.test.mjs')):
        if is_packaged_test(path):
            files[path.relative_to(ROOT).as_posix()] = path
    return files


def package_json(version, tests):
    return json.dumps({
        'name': 'aster-modules',
        'version': version,
        'private': True,
        'description': 'Tested study, research, data, AI-consent and backup modules for the Aster browser',
        'license': 'BSD-3-Clause',
        'type': 'module',
        'scripts': {'test': 'node --test ' + ' '.join(tests), 'example': 'node examples/quickstart.mjs'},
        'engines': {'node': '>=22'},
    }, indent=2) + '\n'


def build(version, output):
    files = package_files()
    tests = sorted(name for name in files if name.startswith('tests/'))
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f'aster-modules-{version}.zip'
    prefix = f'aster-modules-{version}/'
    entries = {name: path.read_bytes() for name, path in files.items()}
    entries['package.json'] = package_json(version, tests).encode()
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for name in sorted(entries):
            info = zipfile.ZipInfo(prefix + name, FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            bundle.writestr(info, entries[name])
    return archive


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', help='defaults to the version in package.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'work/dist')
    args = parser.parse_args()
    version = args.version or json.loads((ROOT / 'package.json').read_text())['version']
    archive = build(version, args.output)
    print(f'{archive}  sha256={hashlib.sha256(archive.read_bytes()).hexdigest()}')


if __name__ == '__main__':
    main()
