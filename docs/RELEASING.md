# Release engineering

No native binaries or installers exist from this run. The included automated release workflow packages **source only** into a draft release for tags matching `v*-source`; it never labels source archives as a browser installer.

## Infrastructure

Hosted Linux/macOS/Windows runners run the small core suite. Full Chromium native compilation uses the manual self-hosted workflow. Budget a 300 GiB SSD workspace, 32–64 GiB RAM, 8+ cores, native SDKs, long build time, dependency caches and artifact storage. Initial checkout/compilation can take hours. Runner-specific quotas and GitHub Actions/storage limits must be checked against the actual account before enabling native release jobs. Untrusted pull requests must not execute on persistent native runners with signing keys.

## macOS path to app/DMG

1. Build/test the exact pin natively for arm64 and, while supported upstream, x64. Verify the application launches and the four native browser tests and platform acceptance checks pass.
2. Apply coordinated product/bundle/helper identifiers, app icons and profile paths. Do not rename only the outer app bundle: embedded framework/helper paths and IDs must agree.
3. Stage the built `.app` and `/Applications` link into a DMG directory and use native `hdiutil create -format UDZO -srcfolder <stage> <name>.dmg`.
4. For Developer ID distribution, sign nested helpers/frameworks and the outer app with reviewed entitlements and hardened runtime. Use upstream signing tooling as the basis. Notarize with `xcrun notarytool` using a secure keychain profile; staple and verify with `stapler`, `codesign` and `spctl`.
5. Run launch/install/update tests on clean supported Macs. Unsigned development builds are acceptable for development but have Gatekeeper/trust limitations and are not notarized releases.

No signing credentials, certificates or IDs are present in this repository. Do not disable sandboxing or add broad signing entitlements to make a failed build appear to work.

## Windows path to executable/installer

1. Build/test native x64 with the pinned Visual Studio/SDK requirements. The upstream executable is `chrome.exe` until full branding is implemented.
2. Audit `chrome/install_static/chromium_install_modes.h`, generated branding resources, product/profile directories, ProgIDs, application IDs, COM/service identities, shortcuts and uninstall/upgrade records. Aster must coexist with Chromium and Chrome without reusing their install registrations or user data.
3. Adapt Chromium's maintained mini-installer/installer pipeline rather than inventing a runtime file allowlist. Build the upstream `mini_installer` target only after identity changes and appropriate packaging review. Validate runtime resources, sandbox binaries, permissions, Start menu shortcut, uninstall and upgrade on clean Windows 10/11 VMs.
4. Add optional Authenticode signing using securely provisioned certificates, then verify signatures. Installer identity migration, updates and user-data preservation need real platform tests.

Generating a stock Chromium installer today would not meet Aster's independent product identity requirement, so the supplied workflow does not publish one.

## Future binary release workflow

After native validation and identity work, extend `native-build.yml` to stage/sign/package per platform, generate SHA-256/SBOM/third-party notices, run installer smoke tests and upload artifacts from that exact commit. Aggregate verified artifacts into a draft GitHub Release, with exact Chromium version, platform/architecture, signing status, tests and known limitations. Do not publish claims based only on a workflow YAML file.

The current stable-watch workflow detects pin drift but no automatic deployed-browser updater is implemented. A security-update process is a prerequisite for ongoing public binary distribution.
