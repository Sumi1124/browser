Aster for Mac
=============

A web browser with built-in study tools: planner, flashcards, research
library with citations, data charts and backups.

INSTALL
1. Drag Aster into the Applications folder.
2. Eject the "Aster" disk image.

FIRST LAUNCH
Aster is free, open-source software and is not signed with a paid Apple
Developer ID, so macOS asks you to confirm the first time:

  1. Open Aster from Applications. macOS says it cannot verify the app.
     Click "Done" (or "Cancel").
  2. Open System Settings > Privacy & Security, scroll down, and click
     "Open Anyway" next to the message about Aster.
  3. Confirm with your password or Touch ID, then click "Open".

You only need to do this once.

IF MACOS STILL WON'T OPEN IT
If you see "Aster is damaged and can't be opened", or there is no
"Open Anyway" button, macOS is blocking the download itself. After
dragging Aster to Applications, open Terminal (Applications > Utilities)
and paste this line, then press Return:

    xattr -dr com.apple.quarantine /Applications/Aster.app

It removes the "downloaded from the internet" flag from Aster only.
Then open Aster normally.

REQUIREMENTS
macOS 13 Ventura or newer, on an Apple silicon or Intel Mac.
(On macOS 13, workspaces share website logins; separate logins per
workspace need macOS 14 Sonoma or newer.)

USING ASTER
- Cmd-T new tab (opens the Start page), Cmd-N new window,
  Shift-Cmd-N private window, Shift-Cmd-T reopen the tab you just closed.
- Cmd-P prints the page; Option-Cmd-L opens your Downloads folder.
- Option-Cmd-S shows or hides the Study Tools sidebar.
- Option-Cmd-C cites the page you are reading.
- Option-Cmd-F opens Split Search: one search, two engines side by side.
- Cmd-D bookmarks the page (or removes the bookmark). The Bookmarks menu
  lists your bookmarks; Option-Cmd-B opens them in the sidebar, where you
  can sort them into folders and import bookmarks from Safari or Chrome.
- Cmd-F finds text on the page; Cmd-G and Shift-Cmd-G move between matches.
- The Workspaces menu opens separate windows for Personal, Business,
  IB MYP, IB Diploma Programme and Research. Each workspace keeps its own
  website logins and cookies.

Your study tools data is saved in
~/Library/Application Support/Aster/Study Tools
and never leaves your Mac. Use Study > Backup to save a copy.

Source code and help: https://github.com/Sumi1124/browser
License: BSD-3-Clause. Aster uses Apple's WebKit (the engine in Safari).
