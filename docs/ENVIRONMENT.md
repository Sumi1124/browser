# Build environment and blockers

Inspected 2026-11-11 before implementation:

- Debian GNU/Linux 13, x86-64.
- About 60 GiB free disk (63 GiB filesystem).
- Effective cgroup memory limit: 8 GiB. No swap.
- CPU quota: 2 cores; 3 processors visible to the process.
- Git, Python 3.12, GCC 14.2, Node 24 and Chromium 156 installed.
- No initial depot_tools, GN, autoninja, Clang, CMake or Ninja checkout/toolchain.
- Installed CMake and clang-format in ignored `work/venv`; npm test dependency is locked in `package-lock.json`.
- Repository initially contained a README and one commit. Its configured GitHub remote is public.

The current official Linux/Windows instructions require at least 100 GB of free disk and 8 GB RAM, recommending more memory. Linux instructions recommend substantial swap on an 8 GB machine. This host cannot fit the source and build. No multi-gigabyte checkout was started just to fail later. Independently testable modules are the fallback expressly permitted by the project brief.

This is not a macOS or Windows host, and it has neither Xcode/macOS SDK nor Visual Studio/Windows SDK. The requested native release artifacts cannot be verified here.

Outbound network policy is restricted. GitHub's official Chromium mirror and the official Chrome for Testing release metadata were accessible. Full checkout infrastructure (googlesource, CIPD and storage endpoints) was not exercised. Provision a build host with access to the destinations used by `DEPS` and depot_tools; do not assume this environment's allowlist can perform `gclient sync`.

## Sources read

- [Official Linux instructions](https://github.com/chromium/chromium/blob/main/docs/linux/build_instructions.md)
- [Official macOS instructions](https://github.com/chromium/chromium/blob/main/docs/mac_build_instructions.md)
- [Official Windows instructions](https://github.com/chromium/chromium/blob/main/docs/windows_build_instructions.md)
- [Official stable channel metadata](https://github.com/GoogleChromeLabs/chrome-for-testing/blob/gh-pages/last-known-good-versions.json), timestamp `2026-11-10T21:12:23.057Z`
- `git ls-remote` verified tag `157.0.8103.50` maps to `049750111b1e5c11565c792b2aeed5541f332bad`.
- Native API declarations and three patch input files were read at that exact upstream tag. File SHA-256 values are committed in `chromium/upstream_files.json`.

Run `python scripts/doctor.py --root /path/to/chromium --require-build` for a new host's resource report. Native dependencies and network reachability must also be checked on that host.
