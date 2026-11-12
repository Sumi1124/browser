# Aster 0.7.1: bug fixes

## Which file should I download?

| File | For |
| --- | --- |
| **`Aster-0.7.1.dmg`** | **Mac users.** Open it and drag Aster to Applications, choosing **Replace**. If you have 0.6.0 or 0.7.0, you can instead choose **Aster → Check for Updates…** and click **Install and Relaunch**. Needs macOS 13 Ventura or newer. |
| `aster-modules-0.7.1.zip` | Developers. The study and research JavaScript modules, with a demo and tests (Node.js 22+). |
| `aster-source-<commit>.zip` / `.tar.gz` | The complete source code |
| `SHA256SUMS.txt` | Checks that your download isn't damaged |

To see which version you have, open a new tab: the version is at the bottom of the Start page. It's also under **Aster → About Aster**.

## Fixed

**Updates**

- **Check timing:** Aster now checks for updates every time it opens, and every three hours while open. Before, it checked once and then waited 20 hours, so a version released just after you opened Aster wasn't offered until the next day.
- **GitHub API busy:** the check no longer fails when GitHub's API is unavailable, which happens on shared networks such as schools. Aster falls back to the public Releases page.
- **macOS blocks the swap:** if macOS won't let Aster replace itself, Aster now saves the already-checked disk image to Downloads and opens it, so you only have to drag it across.

**Design**

- **Sidebar after updating:** the Study Tools sidebar is shown once after updating, even if an older version last had it closed.
- **Sidebar across tabs:** opening or closing the sidebar now applies to every tab and window. Before, each tab kept its own state.

**Browsing**

- **Back to the Start page:** pressing Back to the Start page no longer shows a blank page, and Reload refreshes it.
- **Error pages:** when a page fails to load, its address stays in the address bar and Reload tries it again.
- **Crashing pages:** a page that keeps crashing no longer reloads in a loop.
- **Zoom:** ⌘= now zooms in, as well as ⌘+.
- **Split Search:** the two result panes now reliably fill the window under the search bar.

## Known limits

- **Engine:** Aster for Mac uses WebKit, so Chrome extensions aren't supported.
- **Not notarized:** on first install, open it via System Settings → Privacy & Security → **Open Anyway**. If macOS says it's damaged, run `xattr -dr com.apple.quarantine /Applications/Aster.app`.
- **macOS 13:** workspaces share website logins.
- **Missing features:** history search, and reopening your tabs after quitting, are not included yet.
- **Other platforms:** there is no Windows version.
