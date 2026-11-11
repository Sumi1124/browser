# Aster: a productivity and research browser

Aster is an open-source browser for studying and research, with a planner, flashcards, a research library with citations, data charts and backups built in.

It comes in two forms:

- **Aster for Mac (available now).** A native macOS app built on WebKit, the engine already inside every Mac. It needs no huge Chromium build. See [mac/README.md](mac/README.md).
- **Aster on Chromium (in progress).** The long-term cross-platform design extends **official Chromium** with C++ and native Views controls. Its foundation and overlay are written, but the overlay **has not been compiled**, because a Chromium build needs 100–300 GB of disk. See [validation and limits](docs/STATUS.md).

Both share the same tested study-tools modules in `aster/`.

## Download

Get the latest version from the **[Releases page](https://github.com/Sumi1124/browser/releases/latest)**:

- **`Aster-<version>.dmg`: Aster for Mac.** Open it and drag Aster to Applications. It needs macOS 14 Sonoma or newer and runs on Apple silicon or Intel. Because the app isn't signed with a paid Apple Developer ID, the first time you open it, go to **System Settings → Privacy & Security → Open Anyway**.
- `aster-modules-<version>.zip`: the study and research JavaScript modules, with a demo (`node examples/quickstart.mjs`, needs [Node.js](https://nodejs.org/) 22+) and tests.
- `aster-source-<commit>.zip`: the complete source code.

There's no Windows version yet.

Developers can also run the modules demo straight from a clone:

```sh
npm run example   # writes planner.ics, chart.svg, bibliography files and a backup to ./aster-example-output
```

## Implemented

- Standalone C++20 library: six search providers, safe custom HTTPS templates, Unicode query encoding, synchronized/independent searches, pane identities, swapping, closing, resizing and 2/3/4-pane geometry.
- Workspace library: Personal, Business, IB MYP, IB Diploma Programme, Research and Data Analysis; custom workspaces, named sessions, pinned/grouped tab records and workspace bookmarks. Versioned, bounded persistence rejects private-profile writes and malformed input.
- Native adapter **written, not compiled**: Split Search and Workspaces toolbar controls, Chromium's existing two-pane split model, top/bottom layout, current-tab reuse, pane swap, and profile-local session save/restore. Sessions restore as additional tabs. No existing tabs are closed.
- Citation module: bounded DOM/citation-meta/JSON-LD extraction, missing-field reporting, CSL-JSON, BibTeX and RIS exports. No fabricated authors, dates or publishers. The module is not yet connected to a browser sidebar or a CSL formatting processor.
- Research library: folders, tags, annotations, duplicate detection by DOI, URL or title, and bibliography export.
- Study tools: a planner with recurring tasks, an agenda/overdue view and iCalendar (.ics) export, plus SM-2 spaced-repetition flashcards.
- Data analysis: CSV/TSV/JSON import, type inference, cleaning, descriptive statistics, linear regression, static SVG charts and CSV export protected against formula injection.
- AI consent policy: provider settings that hold keychain references only, redaction, a preview of each request, and single-use consent bound to the exact payload. No network or AI provider code exists.
- Versioned, checksummed backups with migrations and retention planning.
- These library, study, data and backup modules power the **Aster for Mac** study-tools sidebar. In the Chromium design they are not yet connected to the browser UI. See the [module API](docs/API.md).
- **Aster for Mac** (`mac/`): a native Swift/AppKit/WebKit browser with tabs, workspaces that keep logins separate, private windows, Split Search, a study-tools sidebar, Cite This Page, downloads and default-browser support. It is built, unit-tested and self-tested on a hosted Mac in CI.
- Exact Chromium revision pin, source hashes, guarded overlay installer, native build scripts, cross-platform core CI, native build workflow and source-release workflow.

The four Chromium in-process tests are supplied but **have not run**. The passing browser tests exercise metadata extraction in the installed sandboxed Chromium, not an Aster binary.

## Run verified modules

Requires a C++20 compiler and Python 3.9+. This builds only the independently testable core:

```sh
python3 scripts/test_core.py --sanitize  # GCC/Clang on Linux/macOS
```

Or use CMake, including on Windows with MSVC:

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build --config Debug --parallel 2
ctest --test-dir build -C Debug --output-on-failure
```

Research tests require Node 22+ and an installed Chrome/Chromium:

```sh
npm ci --ignore-scripts
npm test
CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 scripts/check_upstream.py
```

`test:browser` preserves Chromium's sandbox and uses local fixtures. `check_upstream.py` downloads only three pinned upstream files and checks patch application/reversal; it does not compile Chromium.

## Build the real browser

Pinned stable: **157.0.8103.50**, commit `049750111b1e5c11565c792b2aeed5541f332bad`, verified 2026-11-11. A pin is not an automatic security-update service.

Follow [BUILDING.md](docs/BUILDING.md) on a suitable native host. The browser retains upstream Chromium branding/install identity during this milestone. **Use a dedicated development profile** until platform branding and installer identities are completed.

## Project map

| Path | Purpose |
| --- | --- |
| `aster/core/` | Dependency-free production C++ policy and persistence |
| `aster/tests/` | Standalone C++ tests, also available as a GN target |
| `aster/research/` | Citation extraction/exports and the research library |
| `aster/study/` | Planner with iCalendar export, flashcards |
| `aster/data/` | Dataset import/statistics, charts and CSV export |
| `aster/ai/` | AI request consent policy (no network code) |
| `aster/storage/` | Versioned backups and retention |
| `aster/common/` | Shared validation helpers and `AsterError` |
| `mac/` | Aster for Mac (Swift, AppKit, WebKit) and its `.dmg` build |
| `chromium/overlay/` | Native browser adapter and in-process tests |
| `chromium/patches/` | Minimal changes to three upstream files |
| `chromium/version.json` | Exact upstream release and commit |
| `scripts/` | Resource checks, checkout, overlay, build, verification |
| `.github/workflows/` | Core CI, opt-in native CI, source releases |
| `docs/` | Architecture, ordered plan, security, release requirements, status |

[Module API](docs/API.md) · [Architecture](docs/ARCHITECTURE.md) · [Ordered implementation plan](docs/PLAN.md) · [Security](SECURITY.md) · [Privacy template](docs/PRIVACY_TEMPLATE.md) · [Release requirements](docs/RELEASING.md)

Aster-authored code is BSD-3-Clause. Chromium and its dependencies keep their own licenses and notices; see [third-party notes](docs/THIRD_PARTY.md).
