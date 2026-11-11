# Third-party licenses and provenance

- Aster-authored C++/JavaScript/Python, tests and documentation: repository BSD-3-Clause LICENSE.
- Chromium: fetched separately from the official source. Preserve Chromium's LICENSE, AUTHORS, COPYING/NOTICE resources and every dependency's license. Aster's license does not relicense upstream code. Patch contexts contain small upstream excerpts under Chromium's BSD-style terms.
- Official depot_tools: fetched from chromium.googlesource.com and governed by its own license. Chromium DEPS resolves additional toolchains/dependencies; audit the actual checkout before distributing binaries.
- `playwright-core` 1.58.2: Apache-2.0, development test dependency only; exact npm integrity pinned by `package-lock.json`.
- CMake and clang-format installed into ignored work tooling are development tools, not shipped Aster runtime code.
- No CSL processor or CSL styles are vendored. Their licenses, attribution and standards fixture testing must be reviewed before implementing formatted citations. CSL-JSON output alone is not APA/MLA/Chicago/Harvard/IEEE formatting.
- No Google Chrome proprietary branding, Widevine distribution or commercial codec license is assumed. API keys for Chromium services are not supplied. Aster's OS identity and original application icons remain future work.

Do not ship node_modules, the ignored work directory, local profiles, credentials, signing certificates or Chromium build caches inside source releases.
