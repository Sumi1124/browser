# Aster 0.6.0: automatic updates

## Which file should I download?

| File | For |
| --- | --- |
| **`Aster-0.6.0.dmg`** | **Mac users.** Open it and drag Aster to Applications, replacing the old copy. Needs macOS 13 Ventura or newer, on Apple silicon or Intel. |
| `aster-modules-0.6.0.zip` | Developers. The study and research JavaScript modules, with a demo and tests (Node.js 22+). |
| `aster-source-<commit>.zip` / `.tar.gz` | The complete source code |
| `SHA256SUMS.txt` | Checks that your download isn't damaged |

**This is the last version you need to download by hand.** From 0.6.0 on, Aster updates itself.

### First launch on a Mac

Aster isn't signed with a paid Apple Developer ID, so macOS asks you to confirm it once:

1. Open Aster. macOS says it can't verify the app; click **Done**.
2. Go to **System Settings → Privacy & Security** and click **Open Anyway** next to the Aster message.
3. Confirm with your password or Touch ID.

If macOS says Aster "is damaged", or there's no **Open Anyway** button, run this in Terminal after dragging Aster to Applications:

```
xattr -dr com.apple.quarantine /Applications/Aster.app
```

## New: automatic updates

- **Daily check:** once a day, Aster checks for a new version. When one is out, you'll see "Aster X is available" with the release notes and an **Install and Relaunch** button. You can also choose **Later** or **Skip This Version**.
- **Check now:** **Aster → Check for Updates…** checks straight away.
- **Turn it off:** **Aster → Check for Updates Automatically** turns the daily check on or off.
- **Checked before installing:** the download must match the SHA-256 fingerprint GitHub publishes for it, the app inside must be Aster at the advertised version, and its code signature must verify. If any check fails, nothing is replaced.
- **Kept across updates:** your study tools data and bookmarks.
- **Where Aster must be:** in your **Applications** folder. If it's still running from the disk image, it will ask you to move it first.

## Known limits

- **Engine:** Aster for Mac uses WebKit, so Chrome extensions aren't supported.
- **Not notarized:** see the first-launch steps above.
- **macOS 13:** workspaces share website logins.
- **Missing features:** history search is not included yet.
- **Other platforms:** there is no Windows version.
