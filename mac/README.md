# Aster for Mac

A native macOS browser built on **WebKit**, the engine already built into every Mac (the same one Safari uses). It needs no Chromium checkout or 300 GB build. The whole app is a few megabytes and builds in minutes.

## Download

Get `Aster-<version>.dmg` from the [Releases page](https://github.com/Sumi1124/browser/releases/latest). It needs macOS 13 Ventura or newer and runs natively on both Apple silicon and Intel Macs. Separate logins per workspace need macOS 14 Sonoma; on macOS 13, workspaces share them.

The app is ad-hoc signed, not signed with a paid Apple Developer ID, so on first launch:

1. Open Aster. macOS says it can't verify the app; click **Done**.
2. Go to **System Settings → Privacy & Security** and click **Open Anyway** next to the Aster message.
3. Confirm with your password or Touch ID.

If macOS says Aster "is damaged", or there's no **Open Anyway** button, run `xattr -dr com.apple.quarantine /Applications/Aster.app` in Terminal. It removes the downloaded-from-the-internet flag from Aster only.

## Features

| Feature | How |
| --- | --- |
| Tabs | Native macOS window tabs (⌘T, ⌘W, the **+** button, drag a tab out into its own window, View → Show All Tabs). New tabs open on a **Start page** with a search box and your bookmarks. ⇧⌘T reopens the last closed tab. |
| Address bar | Type a web address or a search (⌘L). Choose the search engine in **Aster → Search Engine**: Google, DuckDuckGo, Bing, Brave, Yahoo or Ecosia. |
| Workspaces | The workspace button in the toolbar, or the **Workspaces** menu (⌃⌘1–5): Personal, Business, IB MYP, IB Diploma Programme, and Research and Data Analysis. Each workspace has its own cookies and logins, so being signed in under Business doesn't sign you in under Personal. Its tabs group together. |
| Private windows | ⇧⌘N opens a dark window whose cookies and history are kept in memory only and thrown away when it closes. Study tools still work, but website data is never saved. |
| Split Search | ⌥⌘F searches two engines at once, side by side or stacked, with a swap button |
| Bookmarks | ⌘D or the ☆ button bookmarks the page; the star fills in for pages you've already saved, and clicking it again removes the bookmark. The **Bookmarks** menu lists them, with folders as submenus. **Bookmarks → Show All Bookmarks** (⌥⌘B) opens the Bookmarks tab in the sidebar to search, rename, change addresses, sort into folders, and import or export the standard bookmarks file that Safari, Chrome, Firefox and Edge use. |
| Find in page | ⌘F opens the find bar above the page and shows how many matches there are. ⌘G or Return goes to the next match, ⇧⌘G or ⇧Return to the previous one, and Esc closes the bar. |
| Study tools sidebar | ⌥⌘S opens the panel: **Planner** (recurring tasks, overdue list, export to Calendar), **Cards** (spaced-repetition flashcards, CSV import), **Library** (sources, folders, tags, notes, duplicate detection, BibTeX/RIS/CSL-JSON export), **Bookmarks**, **Data** (CSV/JSON statistics, regression, charts) and **Backup** |
| Cite This Page | ⌥⌘C reads the page's citation details (title, authors, date, DOI…) into the Library for you to check. Anything missing is highlighted; nothing is guessed. |
| Downloads | Saved to ~/Downloads and marked as downloaded from the internet, so macOS checks them before they open |
| Default browser | **Aster → Set as Default Browser…** |
| Updates | Aster checks GitHub Releases each time it opens (and every three hours while open) and offers **Install and Relaunch**. If macOS won't let Aster replace itself, it opens the already-verified disk image so you can drag it across. **Aster → Check for Updates…** checks now, and **Check for Updates Automatically** turns daily checks on or off. Before it replaces anything, Aster checks that the download matches the SHA-256 fingerprint GitHub publishes, that the app inside is Aster at the advertised version, and that its code signature verifies. |
| Also included | Print (⌘P), Show Downloads (⌥⌘L), full-screen video, middle-click to open in a new tab, zoom (⌘+ / ⌘- / ⌘0), back/forward swipe, ⌘-click to open in a new tab, pages can be inspected from Safari's Develop menu (Safari → Develop → your Mac → Aster) |

Study-tools data is stored in `~/Library/Application Support/Aster/Study Tools/` as JSON files, written atomically, readable only by your user account, and never uploaded anywhere. If a file can't be read, Aster locks that tool instead of overwriting it, and you can restore a backup.

## How it's built

```
mac/
├── Package.swift            Swift package (macOS 14+)
├── Sources/AsterKit/        UI-free logic: address bar, search engines, workspaces, storage, file names
├── Sources/Aster/           The app (AppKit + WebKit)
│   ├── AppDelegate.swift        menus, workspaces, default browser, opening links from other apps
│   ├── BrowserWindowController  a tab: toolbar, address bar, sidebar, Cite This Page
│   ├── BrowserPane.swift        web view behaviour: navigation policy, pop-ups, dialogs, uploads, errors
│   ├── BrowsingContext.swift    per-workspace and private website data stores
│   ├── SplitSearchWindowController.swift
│   ├── ToolsPanel.swift         aster:// file server, message bridge, citation runner
│   ├── FindBar.swift            find in page
│   ├── Downloads.swift
│   └── SelfTest.swift           `Aster --self-test`
├── Tests/AsterKitTests/     XCTest unit tests
├── Resources/web/           the study-tools page (HTML/CSS/JS)
├── Resources/AppIcon.png
├── Info.plist, build.sh, DMG-README.txt
```

The study-tools sidebar is a web page bundled inside the app and served at `aster://app/`. It imports the same tested JavaScript modules as the rest of the project (`aster/research`, `aster/study`, `aster/data`, `aster/storage`). These security boundaries are enforced in code:

- **Websites never get the bridge.** Ordinary pages have no access to it. Only the bundled tools page can call `load`, `save`, `saveFile`, `openFile`, `citeCurrentPage` and `openURL`, and every request is checked: storage keys must match `^[a-z][a-z-]{0,31}$`, only web links can be opened, and only files inside `Resources/web` are served.
- **The citation extractor runs in an isolated JavaScript world.** A page's own scripts can't see it or tamper with it.
- **Typed addresses can't run code.** A typed `javascript:`, `file:` or `data:` address becomes a search instead. Pages can open other apps (mail, phone and similar) only when you click a link.

## Build it yourself

On a Mac with Xcode 15 or newer:

```bash
cd mac
swift test
```

```bash
bash mac/build.sh
```

`build.sh` writes `work/dist/Aster-<version>.dmg` and stages the app at `mac/.build/stage/Aster.app`. To check a build, run its self-test:

```bash
mac/.build/stage/Aster.app/Contents/MacOS/Aster --self-test
```

The **Mac app** GitHub workflow runs all of this on every change under `mac/` or `aster/`. The **Release** workflow attaches the `.dmg` to each release.

## Limits

- Aster for Mac uses WebKit, not Chromium, so Chrome extensions don't work, and pages behave as they do in Safari.
- It is not notarized; see the first-launch steps above.
- Not yet included: history search, reopening closed tabs, saved passwords beyond what websites keep in their own cookies, and the 3- and 4-pane layouts.
- The Chromium-based design in the rest of this repository is still the long-term plan for a cross-platform build. The two share the same study-tools modules.
