# Draft privacy policy template

**Template for a future Aster release. Not a verified policy for a shipped product.** Fill in the operator, contact, jurisdiction, effective date and audited browser-version behavior before publication.

Operator: [maintainer/legal entity]. Contact: [privacy contact]. Effective date: [date].

Aster's proposed core functions operate locally. Ordinary web navigation and explicit searches send requests to the selected websites/search providers under their policies. Workspace names, saved tab URLs/titles/groups/pins and bookmarks are stored in the selected browser profile. Base64 storage is not encryption. Workspace labels within a profile do not isolate cookies; use separate browser profiles for separate identities.

The implemented Aster modules do not send telemetry, upload citations or contact AI services. Upstream Chromium services, provider requests, crash reporting, update checks and any third-party integration must be audited and described for the actual binary. The intended product policy is optional telemetry disabled by default; no completed binary audit is claimed here.

Private browsing does not save Aster workspace catalogs. It is not anonymity from visited sites, network operators, employers or local device monitoring. Normal Chromium private-browsing behavior and its limitations apply.

Citation extraction inspects metadata on the current page locally. Metadata can be absent or incorrect; the future citation UI must let users review/correct it. User-requested exports contain the sources selected by the user. Clearing workspaces, research records, notes and datasets will require explicit deletion controls in the completed application; those controls are not implemented in this milestone.

AI is optional and unimplemented. Before introducing it, provide a provider/API configuration interface, OS secure credential storage, a preview of the exact selected content and explicit permission before external transmission. API use may require an account and separate billing; consumer chat subscriptions do not imply API access. Document retention and processing per provider. Do not send content silently.

Retention, access/deletion requests, student/minor protections, legal bases and applicable privacy rights: [complete based on the operator's actual release and jurisdictions].
