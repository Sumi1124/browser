# Aster 0.7.0: the full design, built in

## Which file should I download?

| File | For |
| --- | --- |
| **`Aster-0.7.0.dmg`** | **Mac users.** If you have Aster 0.6.0, you don't need this: choose **Aster → Check for Updates…** (or wait for the daily check) and click **Install and Relaunch**. Otherwise, open it and drag Aster to Applications. Needs macOS 13 Ventura or newer. |
| `aster-modules-0.7.0.zip` | Developers. The study and research JavaScript modules, with a demo and tests (Node.js 22+). |
| `aster-source-<commit>.zip` / `.tar.gz` | The complete source code |
| `SHA256SUMS.txt` | Checks that your download isn't damaged |

## What changed

0.5.0 introduced the redesign, but on a fresh install several parts of it didn't show. This release makes the app match the design:

- **Study Tools sidebar:** now open by default. It's half of Aster's design, but it used to start hidden until you pressed ⌥⌘S. You can still hide it, and Aster remembers your choice.
- **Tab bar:** always visible, even with one tab, showing the page title, as in the design.
- **Start page:** now shows **Today**, with your tasks for today (including overdue ones and what's next) and the flashcards due, under your bookmarks. It updates as you tick off tasks or study. Private windows never show it.
- **Sidebar button:** turns violet while the sidebar is open.

## Known limits

- **Engine:** Aster for Mac uses WebKit, so Chrome extensions aren't supported.
- **Not notarized:** on first install, open it via System Settings → Privacy & Security → **Open Anyway**. If macOS says it's damaged, run `xattr -dr com.apple.quarantine /Applications/Aster.app`.
- **macOS 13:** workspaces share website logins.
- **Missing features:** history search is not included yet.
- **Other platforms:** there is no Windows version.
