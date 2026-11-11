import contextlib
import difflib
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import apply_overlay
import doctor

class OverlayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.repo = root / 'aster-repo'; self.repo.mkdir()
        self.src = root / 'src'; self.src.mkdir()
        (self.repo / 'aster').mkdir()
        (self.repo / 'aster/core.txt').write_text('Aster source\n')
        (self.repo / 'LICENSE').write_text('License\n')
        (self.repo / 'chromium/overlay').mkdir(parents=True)
        (self.repo / 'chromium/patches').mkdir()
        (self.src / 'upstream.txt').write_text('before\n')
        for command in [['git', 'init', '--quiet'], ['git', 'add', '.'],
            ['git', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Fixture']]:
            subprocess.run(command, cwd=self.src, check=True)
        head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=self.src, text=True).strip()
        (self.repo / 'chromium/version.json').write_text(json.dumps({'revision': head}))
        (self.repo / 'chromium/upstream_files.json').write_text(json.dumps({'upstream.txt': hashlib.sha256(b'before\n').hexdigest()}))
        self.patch = self.repo / 'chromium/patches/change.patch'
        self.patch.write_text(''.join(difflib.unified_diff(['before\n'], ['after\n'], fromfile='a/upstream.txt', tofile='b/upstream.txt')))
        self.root_mock = mock.patch.object(apply_overlay, 'ROOT', self.repo); self.root_mock.start(); self.addCleanup(self.root_mock.stop)
        self.patch_mock = mock.patch.object(apply_overlay, 'PATCH', self.patch); self.patch_mock.start(); self.addCleanup(self.patch_mock.stop)
    def apply(self, check=False):
        with contextlib.redirect_stdout(io.StringIO()): apply_overlay.apply(self.src, check)
    def test_check_is_read_only(self):
        self.apply(check=True)
        self.assertEqual((self.src / 'upstream.txt').read_text(), 'before\n')
        self.assertFalse((self.src / 'aster').exists())
    def test_install_and_idempotency(self):
        self.apply(); self.apply()
        self.assertEqual((self.src / 'upstream.txt').read_text(), 'after\n')
        self.assertEqual((self.src / 'aster/core.txt').read_text(), 'Aster source\n')
    def test_wrong_revision(self):
        (self.repo / 'chromium/version.json').write_text('{"revision":"wrong"}')
        with self.assertRaisesRegex(RuntimeError, 'HEAD'): self.apply()
    def test_changed_upstream_is_preserved(self):
        (self.src / 'upstream.txt').write_text('User edit\n')
        with self.assertRaisesRegex(RuntimeError, 'source mismatch'): self.apply()
        self.assertEqual((self.src / 'upstream.txt').read_text(), 'User edit\n')
    def test_unowned_destination_is_preserved(self):
        (self.src / 'aster').mkdir(); (self.src / 'aster/core.txt').write_text('User file\n')
        with self.assertRaisesRegex(RuntimeError, 'Unowned'): self.apply()
        self.assertEqual((self.src / 'aster/core.txt').read_text(), 'User file\n')
    def test_installed_user_edits_are_preserved(self):
        self.apply(); (self.src / 'aster/core.txt').write_text('User edit\n')
        with self.assertRaisesRegex(RuntimeError, 'was edited'): self.apply()
    def test_overlay_updates_require_clean_checkout(self):
        self.apply(); (self.repo / 'aster/core.txt').write_text('New version\n')
        with self.assertRaisesRegex(RuntimeError, 'Different overlay'): self.apply()
    def test_invalid_patch_fails_before_copying(self):
        self.patch.write_text(self.patch.read_text().replace('-before', '-missing'))
        with self.assertRaises(subprocess.CalledProcessError): self.apply()
        self.assertFalse((self.src / 'aster').exists())

class DoctorTests(unittest.TestCase):
    def test_resource_shortage_blocks_checkout(self):
        with tempfile.TemporaryDirectory() as root, mock.patch('doctor.shutil.disk_usage', return_value=type('Usage', (), {'free': 60 * 1024**3})()):
            report = doctor.inspect(root)
        self.assertTrue(any('100 GiB' in blocker for blocker in report['blockers']))
    def test_native_host_mismatch(self):
        with mock.patch('doctor.platform.system', return_value='Linux'):
            report = doctor.inspect(Path.cwd(), 'mac')
        self.assertTrue(any('Mac' in blocker for blocker in report['blockers']))

if __name__ == '__main__': unittest.main()
