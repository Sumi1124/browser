#!/usr/bin/env python3
"""Create clearly named source archives and checksums from the committed HEAD."""
import hashlib
from pathlib import Path
import subprocess
ROOT = Path(__file__).resolve().parents[1]
def main():
    commit = subprocess.check_output(['git', 'rev-parse', '--short=12', 'HEAD'], cwd=ROOT, text=True).strip()
    output = ROOT / 'work/dist'
    output.mkdir(parents=True, exist_ok=True)
    sums = []
    for extension, format_name in [('zip', 'zip'), ('tar.gz', 'tar.gz')]:
        path = output / f'aster-source-{commit}.{extension}'
        subprocess.run(['git', 'archive', '--format=' + format_name, '--prefix=aster/', '--output=' + str(path), 'HEAD'], cwd=ROOT, check=True)
        sums.append(hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.name)
    (output / 'SHA256SUMS.txt').write_text('\n'.join(sums) + '\n')
    print('Source-only archives created in work/dist; no browser binaries are included.')
if __name__ == '__main__': main()
