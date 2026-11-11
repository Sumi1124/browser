# Aster 0.4.0: bookmarks and find in page

## Which file should I download?

| File | For |
| --- | --- |
| **`Aster-0.4.0.dmg`** | **Mac users.** Open it and drag Aster to Applications, replacing the old copy if you have one. Needs macOS 14 Sonoma or newer, on Apple silicon or Intel. |
| `aster-modules-0.4.0.zip` | Developers. The study and research JavaScript modules, with a demo and tests (Node.js 22+). |
| `aster-source-<commit>.zip` / `.tar.gz` | The complete source code |
| `SHA256SUMS.txt` | Checks that your download isn't damaged |

### First launch on a Mac

Aster isn't signed with a paid Apple Developer ID, so macOS asks you to confirm it once:

1. Open Aster. macOS says it can't verify the app; click **Done**.
2. Go to **System Settings → Privacy & Security** and click **Open Anyway** next to the Aster message.
3. Confirm with your password or Touch ID.

## New in 0.4.0

- **Bookmarks:**
  - Press ⌘D or click the ☆ in the toolbar. The star fills in on pages you've saved, and clicking it again removes the bookmark.
  - The new **Bookmarks** menu lists your bookmarks, with folders as submenus.
  - **Show All Bookmarks** (⌥⌘B) opens a Bookmarks tab in the sidebar where you can search, rename, sort into folders and delete bookmarks.
  - You can **import** bookmarks exported from Safari, Chrome, Firefox or Edge, and **export** your own the same way. Duplicates are skipped, and nested folders are kept as "Outer / Inner".
- **Find in page** (⌘F): a find bar with a match count. Use ⌘G or Return for the next match, ⇧⌘G for the previous one, and Esc to close.
- **Backups** now include your bookmarks.

## Fixed

- **Delete buttons in the sidebar:** in 0.3.0, the delete buttons for flashcards, research sources and repeating tasks did nothing in the Mac app, because their "Are you sure?" question was never shown. They now ask and work.
- **Folders in the Bookmarks tab:** creating a folder no longer switches the view to the new, empty folder.

## Tested

The app's built-in self-test runs inside the real app on a hosted Mac and now also checks:

- The sidebar's confirmation dialogs work.
- A bookmark added with ⌘D can be read by the sidebar, and one saved by the sidebar shows up in the native menu and star.
- Find in page finds and counts matches, ignoring case and hidden text, and reports "not found" correctly.

The Swift unit tests, the end-to-end sidebar test and 38 JavaScript tests also pass.

## Known limits

- **Engine:** Aster for Mac uses WebKit, so Chrome extensions aren't supported.
- **Not notarized:** see the first-launch steps above.
- **Missing features:** history search and reopening closed tabs are not included yet.
- **Other platforms:** there is no Windows version.
