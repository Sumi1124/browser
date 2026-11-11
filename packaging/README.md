# Aster study and research modules

This download contains the working logic behind Aster's study and research tools, packaged so you can run it, test it and build an interface on top of it.

> **This is not a browser app.** There is no app to double-click here. The Aster browser itself (built on Chromium) has not been compiled yet. This package is the tested JavaScript logic its screens will use.

## What's inside

| Folder or file | What it does |
| --- | --- |
| `aster/research/` | Citation extraction from web pages; a research library with folders, tags, notes and duplicate detection; bibliography export (BibTeX, RIS, CSL-JSON) |
| `aster/study/` | A planner with recurring tasks, an upcoming/overdue list and calendar (`.ics`) export; flashcards with spaced repetition (SM-2) |
| `aster/data/` | CSV/TSV/JSON import, column types, cleaning, statistics (mean, median, standard deviation, quartiles) and linear regression; SVG charts and safe CSV export |
| `aster/ai/` | Privacy rules for future AI features: shows exactly what would be sent, hides emails and keys, and asks for consent each time. **No AI service is contacted.** |
| `aster/storage/` | Backups with version numbers and a checksum, upgrades from older backups, and a plan for which old backups to keep |
| `examples/quickstart.mjs` | A demo that uses every module and writes example files |
| `tests/` | The automated tests (32 of them) |
| `API.md` | Full reference for every function |
| `LICENSE` | BSD-3-Clause |

## Requirements

[Node.js](https://nodejs.org/) version 22 or newer. Nothing else needs to be installed: the modules have no dependencies.

Check your version:

```bash
node --version
```

## Try it

1. Unzip the download and open a terminal in the unzipped folder.
2. Run the demo:

   ```bash
   node examples/quickstart.mjs
   ```

   It creates an `aster-example-output` folder containing:

   - `planner.ics`: open it with Google Calendar, Apple Calendar or Outlook to import the example tasks.
   - `chart.svg`: open it in any web browser.
   - `bibliography.bib` and `bibliography.ris`: import them into Zotero, Mendeley or EndNote.
   - `data.csv`: open it in Excel, Numbers or Google Sheets.
   - `aster-backup-….json`: an example backup file.

3. Run the tests:

   ```bash
   npm test
   ```

## Use it in your own code

```js
import {Planner, toIcs} from './aster/study/planner.mjs';

const planner = new Planner();
planner.add({id: 'essay', title: 'English essay', due: '2026-12-01', category: 'assignment', priority: 'high'});
planner.add({id: 'gym', title: 'Gym', due: '2026-11-16', time: '17:00', recurrence: {freq: 'weekly', byDay: ['MO', 'TH']}});

console.log(planner.agenda('2026-11-16', {days: 7}));
const calendarFile = toIcs(planner.tasks, {now: new Date().toISOString()});
```

`API.md` documents every module and maps each screen of the planned interface to the functions it should call.

## Good to know

- Everything runs on your own computer. Nothing is uploaded, and no account is needed.
- Problems are reported as an `AsterError` with a `code` (for example `invalid_date`) and a readable `message`.
- Not included yet: APA/MLA citation formatting, Excel (`.xlsx`) import, real AI requests, and encrypted backups.

## Verify your download

Each release lists a `SHA256SUMS.txt` file. To check that your download matches, run this in the folder that contains the zip:

```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
```

On macOS, use `shasum -a 256 -c SHA256SUMS.txt --ignore-missing`.
