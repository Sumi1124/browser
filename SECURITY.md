# Security

This source milestone is not an audited, built or supported daily-use browser. Native integration has not been compiled. Do not treat successful standalone tests as a browser security review.

Aster modules introduce no sandbox, site-isolation, certificate, web-security or download-permission overrides. The native adapter creates normal Chromium tabs, preserving upstream delegates and services rather than injecting a privileged API into sites. Search requests originate from explicit native controls. All custom templates and persisted data are validated; private profiles cannot persist the catalog. The citation module performs no networking and runs without native bindings.

Before any release:

- Resolve current stable and security updates, review the pin/patch and build on each supported platform. `stable-watch.yml` detects version drift; it does not patch a deployed browser or replace an updater.
- Validate renderer/browser boundaries, navigation/provider policies, popups/downloads/media permissions, malicious metadata/data files, profile isolation and persistence recovery.
- Complete independent branding/install identities, automatic security updates, signed installers and trusted update manifests. Preserve Chromium protections and notices.
- Add native integration tests for concurrent windows, profile shutdown, off-the-record lifetimes, preferences and renderer crashes; run accessibility/performance/security checks.

For a suspected vulnerability, do not post credentials, private browsing data or an exploitable private report in a public issue. Use the repository's private vulnerability reporting channel if enabled; maintainers must configure a private reporting contact before a public binary release. No private channel is claimed to be configured by this milestone.
