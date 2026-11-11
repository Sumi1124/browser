# Aster 0.5.0: a fresh look, and fixes

## Which file should I download?

| File | For |
| --- | --- |
| **`Aster-0.5.0.dmg`** | **Mac users.** Open it and drag Aster to Applications, replacing the old copy. Now needs **macOS 13 Ventura** or newer (was macOS 14), on Apple silicon or Intel. |
| `aster-modules-0.5.0.zip` | Developers. The study and research JavaScript modules, with a demo and tests (Node.js 22+). |
| `aster-source-<commit>.zip` / `.tar.gz` | The complete source code |
| `SHA256SUMS.txt` | Checks that your download isn't damaged |

### First launch on a Mac

Aster isn't signed with a paid Apple Developer ID, so macOS asks you to confirm it once:

1. Open Aster. macOS says it can't verify the app; click **Done**.
2. Go to **System Settings → Privacy & Security** and click **Open Anyway** next to the Aster message.
3. Confirm with your password or Touch ID.

If macOS says Aster "is damaged", or there's no **Open Anyway** button, run this in Terminal after dragging Aster to Applications:

```
xattr -dr com.apple.quarantine /Applications/Aster.app
```

## New look

The redesign is calm and native-looking:

- **Start page:** new tabs open on a search box and your bookmarks as tiles, instead of a blank white page.
- **Sidebar:** the Study Tools sidebar is translucent, with an icon tab bar, large headings, round checkboxes and a full dark mode.
- **Planner:** adding a task is a single line. Date, time and repeat options are tucked under "Date, time and more", and repeating tasks no longer fill every day of the list.
- **Flashcards:** a progress bar, plus colour-coded Again, Hard, Good and Easy buttons that show when you'll see the card next.
- **Bookmarks:** folder chips and coloured monograms.
- **Window:** a thin loading bar under the toolbar, and a workspace button in the toolbar that shows where you are and opens other workspaces.

## Fixed

- **Opening the app:** Aster now runs on macOS 13 Ventura, and the read-me explains what to do if macOS blocks it.
- **Address bar:** one click now selects the whole address, as in Safari. Before, the cursor landed in the middle of the URL.
- **Full-screen video:** the full-screen button on YouTube and other video players works.
- **Middle-click:** middle-clicking a link opens it in a new tab.
- **Planner time field:** it looked pre-filled ("12:30 PM") when it wasn't. It's now an optional field under "Date, time and more".

## Also new

- **Reopen Closed Tab** (⇧⌘T). Private windows are never remembered.
- **Print** (⌘P).
- **Show Downloads** (⌥⌘L).

## Known limits

- **Engine:** Aster for Mac uses WebKit, so Chrome extensions aren't supported.
- **Not notarized:** see the first-launch steps above.
- **macOS 13:** workspaces share website logins.
- **Missing features:** history search is not included yet.
- **Other platforms:** there is no Windows version.
