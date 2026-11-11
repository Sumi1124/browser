# Implementation and validation status

Recorded 2026-11-11. **No full Chromium checkout, native Aster compile, launch, installer or signed release has completed.**

## Executed in this environment

| Check | Result |
| --- | --- |
| C++20 compile with warnings as errors | Passed (GCC 14.2) |
| Core tests with AddressSanitizer and UndefinedBehaviorSanitizer | 18 named cases passed; includes 20,000 corrupted inputs |
| CMake configure/build and CTest | Passed on Linux |
| Overlay/resource tooling tests | 10 passed |
| Citation/export Node tests | 5 passed |
| Metadata tests in installed sandboxed Chromium 156.0.8078.79 | 4 passed |
| Patch application and exact reversal on pinned 157.0.8103.50 files | Passed; three upstream files |
| Native overlay compilation and GN dependency checks | Not run; full checkout unavailable |
| Four Aster Chromium in-process tests | Written; not run |
| macOS/Windows CMake builds | CI configured; see actual GitHub checks for results |
| Installers, signing, notarization and release binaries | Not built |

The installed Chromium used for metadata tests is an environment tool. It is not relabeled or presented as an Aster build. No visual mockup has been substituted for the browser.

## Capability boundaries

| Requirement | Current implementation |
| --- | --- |
| Core navigation, downloads, history, private mode, profiles, ordinary bookmarks and tab groups | Delegated to upstream Chromium; no Aster binary validated |
| Native dual search | Adapter uses `chrome::AddAndReturnTabAt`, `NavigationController` and `TabStripModel::AddToNewSplit`; uncompiled |
| Resizing, independent scrolling/navigation, closing panes | Reuses native Chromium split-tab UI; not independently reimplemented |
| Query synchronization | Tested in core; native adapter synchronizes explicit toolbar submissions only, not forms on provider websites |
| Three/four panes | Geometry/state model tested; not connected to native rendering |
| Workspaces | Catalog and persistence tested; native bubble adapter written. No live workspace sidebar or automatic workspace switching |
| Sessions | Manual named snapshots in adapter; upstream crash recovery remains upstream. Snapshot URLs/titles/groups/pins supported; split orientation/history/form state not captured |
| Workspace bookmarks | Core model/codec tested; native workspace bookmark UI not implemented |
| Profile separation | Native adapter uses only the caller's Profile/PrefService. Workspaces within one profile share cookies; Business is not automatically a separate profile |
| Tab orientation, command palette, customizable toolbar/theme | Upstream support where available; Aster-specific controls/design not implemented |
| Citation extraction/exports | Tested module; no privileged bindings and no network requests |
| APA/MLA/Chicago/Harvard/IEEE | CSL processor/styles and citation sidebar not implemented |
| Research library folders/tags/annotations/bibliographies/PDF citations | Not implemented |
| MYP/DP/business tools | Default workspace names only; planners, OPVL, EE/TOK/IA, notes, flashcards and timers not implemented |
| Data import/analysis/charts | Not implemented |
| AI integrations/secure key storage | Not implemented; no provider content transmission code exists |
| Branding/icons/install/update identities | Not applied; upstream identity remains |
| Native release workflows | Native build/test workflow supplied; installer/signing/release pipeline remains incomplete |

## Known development limitations

- Search providers and layouts are selected for each Split Search operation; provider preferences are not yet persisted.
- Restorable URL policy supports HTTP(S) ASCII/punycode hostnames, `about:blank` and `chrome://newtab/`. IPv6 literals, file URLs and other internal pages are intentionally rejected by this initial codec. Direct Chromium browsing is unaffected.
- Named snapshots currently restore groups by title; separate groups sharing a title are combined, and unnamed groups/color/collapse state are not represented.
- Native English UI strings need GRIT localization, accessibility testing, keyboard shortcut integration, and small-window layout review.
- Profile preference writes rely on Chromium's normal persistence schedule. Power-loss durability and cross-window/native lifecycle behavior still need integration tests.
- The bounded codec is a storage format, not encryption. A profile's local operating-system access controls protect its preferences.
- No security, performance or production-readiness claim follows from standalone tests or patch applicability.
