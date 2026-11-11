# Build instructions

## Independent library and tests

See the README quick start. CMake builds `aster_core` and `aster_core_tests` only; it does **not** build a browser. On Windows, use a Visual Studio developer terminal with CMake and the MSVC toolchain. Node tests do not require an AI account or search-provider access.

## Actual Chromium checkout and build

Use an ordinary user account and a dedicated checkout separate from this repository. Allow at least 100 GiB free for initial source/build; provision 300 GiB SSD, 32–64 GiB RAM and 8+ cores for practical iterative builds. Hosted Actions runners are suitable for core tests, not this full checkout. No remote build service is assumed.

Read the **pinned** upstream instructions and follow their native SDK/tool requirements:

- [macOS](https://github.com/chromium/chromium/blob/157.0.8103.50/docs/mac_build_instructions.md): supported Intel/Arm Mac, APFS, Xcode and matching SDK.
- [Windows](https://github.com/chromium/chromium/blob/157.0.8103.50/docs/windows_build_instructions.md): x64 Windows 10+, NTFS, supported Visual Studio C++/MFC/ATL components and Windows SDK. Current instructions read during setup specify Visual Studio 2026 >=18.0.0; the pinned file is authoritative.
- [Linux](https://github.com/chromium/chromium/blob/157.0.8103.50/docs/linux/build_instructions.md): useful for development, though not a requested release platform. Install dependencies using upstream's supported distro process.

From this Aster repository, substituting native paths:

```sh
python3 scripts/doctor.py --root /build/aster-chromium --require-build
python3 scripts/check_stable.py
python3 scripts/bootstrap.py --root /build/aster-chromium
python3 scripts/apply_overlay.py --src /build/aster-chromium/src --check
python3 scripts/apply_overlay.py --src /build/aster-chromium/src
python3 scripts/build.py --src /build/aster-chromium/src --depot-tools /build/aster-chromium/depot_tools --cpu arm64 --jobs 8 --run-tests
```

Use `--cpu x64` for Intel Mac/Windows. On Windows the Python launcher may be `python`; paths such as `D:\aster-chromium` work with these scripts. First complete upstream depot_tools initialization and Visual Studio setup in the same terminal. The script sets `DEPOT_TOOLS_WIN_TOOLCHAIN=0` to use installed Microsoft SDKs.

`bootstrap.py` runs official `fetch --nohooks --no-history chromium`, checks out the pinned stable tag/commit, then `gclient sync` and `gclient runhooks`. It refuses dirty source trees. Both GitHub and Chromium checkout/dependency/toolchain hosts must be reachable. Bootstrap and GN scripts have been unit/source checked, but the complete native commands have **not** run in this environment.

`build.py` verifies the installed overlay, runs `gn gen --check`, and compiles `chrome`, `aster:aster_core_tests` and `browser_tests` through `autoninja`. Its `--run-tests` switch runs the core executable and four `AsterSplitSearchBrowserTest.*` cases. Linux tests use upstream `testing/xvfb.py` when needed. No sandbox or web-security disabling flag is added.

To operate manually after setup:

```sh
cd /build/aster-chromium/src
# Put the official depot_tools directory on PATH first.
gn gen out/Aster --check --args='target_cpu="arm64" is_debug=false is_component_build=false symbol_level=1 is_chrome_branded=false use_remoteexec=false dcheck_always_on=true'
autoninja -C out/Aster chrome aster:aster_core_tests browser_tests
out/Aster/aster_core_tests
out/Aster/browser_tests --gtest_filter='AsterSplitSearchBrowserTest.*' --test-launcher-jobs=1
```

Windows executables have `.exe` suffixes. Use PowerShell-appropriate quoting for GN arguments or use `build.py`.

## First launch and acceptance

The initial build still has upstream product identity. Do not reuse an existing personal Chromium profile. On macOS:

```sh
out/Aster/Chromium.app/Contents/MacOS/Chromium --user-data-dir=/build/aster-dev-profile
```

On Windows launch `out\Aster\chrome.exe --user-data-dir=D:\aster-dev-profile`. On Linux use `out/Aster/chrome --user-data-dir=/build/aster-dev-profile`.

Check toolbar controls, both search providers, independent history/scroll/zoom, resizing and native split menu close/swap, top/bottom, current-tab reuse, rejected templates, named sessions/group/pin restoration, restart persistence and two windows editing different workspaces. Confirm workspaces are disabled in private browsing and normal/private profile state stays separate. Test actual provider pages without scraping or relaxing security.

The new controls are native Views code. Chromium's upstream WebUI-toolbar experiments, very narrow windows and platform accessibility still need integration validation.

## Updating an installed overlay

An installed overlay is intentionally dirty relative to Chromium. Never rerun bootstrap on it as a way to erase changes. Use another clean pinned checkout for an updated overlay, or preserve/review your changes before preparing a new worktree. The installer refuses automatic overwrites or forced patching.

The manual native workflow requires a self-hosted runner labeled `aster-chromium` and one of `macos-arm64`, `macos-x64`, `windows-x64`, plus an environment `native-<target>` with `ASTER_CHROMIUM_ROOT` configured. It is never triggered on pull requests. Native CI currently builds/tests; it does not package or publish installers.
