# Aster 0.3.0: Aster for Mac

**Aster is now a browser you can install on a Mac.** It is built on WebKit, the engine already inside every Mac, so it doesn't need a huge Chromium build.

## Which file should I download?

| File | For |
| --- | --- |
| **`Aster-0.3.0.dmg`** | **Mac users.** Open it and drag Aster to Applications. Needs macOS 14 Sonoma or newer, on Apple silicon or Intel. |
| `aster-modules-0.3.0.zip` | Developers. The study and research JavaScript modules, with a demo and tests (Node.js 22+). |
| `aster-source-<commit>.zip` / `.tar.gz` | The complete source code |
| `SHA256SUMS.txt` | Checks that your download isn't damaged |

### First launch on a Mac

Aster isn't signed with a paid Apple Developer ID, so macOS asks you to confirm it once:

1. Open Aster. macOS says it can't verify the app; click **Done**.
2. Go to **System Settings → Privacy & Security** and click **Open Anyway** next to the Aster message.
3. Confirm with your password or Touch ID.

## New in 0.3.0: Aster for Mac

- **Browsing:** native tabs, an address bar with a choice of six search engines, downloads, zoom, swipe back and forward, and the option to set Aster as your default browser.
- **Workspaces:** Personal, Business, IB MYP, IB Diploma Programme, and Research and Data Analysis. Each keeps its own logins and cookies.
- **Private windows:** nothing about the websites you visit is saved.
- **Split Search:** one search, two engines, side by side.
- **Study Tools sidebar** (⌥⌘S): a planner with recurring tasks and Calendar export, spaced-repetition flashcards, a research library with folders, tags, notes, duplicate detection and bibliography export, data statistics and charts, and backups.
- **Cite This Page** (⌥⌘C): fills in a citation from the page you're reading, highlights anything missing, and never guesses.

All study data stays on your Mac in `~/Library/Application Support/Aster/Study Tools/`.

## Tested

- The app is built for both Apple silicon and Intel on a hosted Mac, and its built-in self-test runs there. The self-test loads the study tools page with real storage on disk, cites a test page without the page being able to interfere, and checks that only bundled files are served to the tools page.
- The Swift logic has unit tests.
- The study-tools panel is tested end to end in a browser.
- The JavaScript modules have 33 tests, including fuzzing.

## Known limits

- **Engine:** Aster for Mac uses WebKit, so Chrome extensions aren't supported.
- **Not notarized:** see the first-launch steps above.
- **Missing features:** bookmarks, history search, find in page and reopening closed tabs are not included yet.
- **Other platforms:** there is no Windows version yet. The Chromium-based design in the source code remains the plan for other platforms.
