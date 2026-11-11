# Aster 0.2.0: study and research modules

## Which file should I download?

| File | For |
| --- | --- |
| **`aster-modules-0.2.0.zip`** | **Most people.** The tested study, research and data tools, with a README, a demo (`node examples/quickstart.mjs`) and the tests. Needs Node.js 22 or newer. |
| `aster-source-<commit>.zip` / `.tar.gz` | Developers. The whole repository, including the C++ core, the Chromium overlay and the build scripts. |
| `SHA256SUMS.txt` | Checks that your download isn't damaged |

**This release is not a browser app.** It has no installer, `.app`, `.dmg` or `.exe`. The Chromium-based browser has not been compiled yet; see docs/STATUS.md for why.

## New in 0.2.0

- **Research library.** Folders, tags and notes on sources. Detects duplicates by DOI, by URL (ignoring tracking codes) or by title, can fill in missing details from a duplicate, and exports bibliographies as BibTeX, RIS or CSL-JSON.
- **Planner.** Assignments, exams and tasks, with daily/weekly/monthly repeats, an upcoming and overdue view, and export to Google, Apple or Outlook calendars (`.ics`).
- **Flashcards.** Spaced repetition (SM-2), import from spreadsheet rows, and study statistics.
- **Data analysis.** CSV, TSV and JSON import; column types; cleaning; mean, median, standard deviation and quartiles; and linear regression.
- **Charts and exports.** Bar, line and scatter charts as SVG, and CSV export that blocks spreadsheet formula injection.
- **AI consent.** Shows a preview of exactly what would be sent, hides emails and keys, and approves one request at a time. No AI service is contacted.
- **Backups.** Versioned and checksummed, with upgrades from older formats and a plan for which old backups to keep.
- Documentation: an API reference (`API.md`) for building the interface on top of these modules.

## Included from 0.1 (source)

- A C++ core for split search and workspaces.
- A Chromium 157.0.8103.50 overlay. It is written but **not compiled**.
- Citation metadata extraction.
- Build scripts and CI.

## Known limits

The modules are not connected to a browser interface yet. These are not included: APA/MLA formatting, `.xlsx` import, real AI requests, encrypted backups, and native installers.
