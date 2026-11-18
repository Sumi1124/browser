# Aster 0.8.0: ad and tracker blocking

## Which file should I download?

| File | For |
| --- | --- |
| **`Aster-0.8.0.dmg`** | **Mac users.** Open it and drag Aster to Applications, choosing **Replace**. If you already have 0.7.1, you can instead choose **Aster → Check for Updates…** and click **Install and Relaunch**. Needs macOS 13 Ventura or newer. |
| `aster-modules-0.8.0.zip` | Developers. The study and research JavaScript modules, with a demo and tests (Node.js 22+). |
| `aster-source-<commit>.zip` / `.tar.gz` | The complete source code |
| `SHA256SUMS.txt` | Checks that your download isn't damaged |

To see which version you have, open a new tab: the version is at the bottom of the Start page. It's also under **Aster → About Aster**.

## New

**Faster browsing with ad and tracker blocking**

- Aster now blocks advertising networks, analytics and tracking pixels, more than 140 well-known hosts plus a few tracking scripts. Blocked requests are never sent, so pages download less and load faster.
- It's built into WebKit, which compiles the rules into native code. Pages run no extra scripts, and Aster keeps the compiled rules, so it starts with blocking already on.
- Only third-party requests are blocked, so a site's own images, videos and logins keep working. The empty boxes where ads would have been are hidden too.
- It works in every workspace and in private windows.
- **Aster → Block Ads and Trackers** turns blocking on or off. **Aster → Pause Blocking on This Site** turns it off for just the site you are on (and its subdomains) if a page doesn't work properly, and reloads it. The same menu item resumes blocking.

## Known limits

- **Not an AI:** blocking uses fixed lists of known hosts, not a learning model. It's fast and predictable, but it only blocks what's on the list, and the list is built into each Aster version. Newer ad servers are covered when you update Aster.
- **No counter yet:** WebKit doesn't tell apps how many requests it blocked, so Aster can't show a count.
- **Not every ad:** ads that a site serves from its own address look like part of the site, so they aren't blocked.
- **Engine:** Aster for Mac uses WebKit, so Chrome extensions aren't supported.
- **Not notarized:** on first install, open it via System Settings → Privacy & Security → **Open Anyway**. If macOS says it's damaged, run `xattr -dr com.apple.quarantine /Applications/Aster.app`.
- **macOS 13:** workspaces share website logins.
- **Missing features:** history search, and reopening your tabs after quitting, are not included yet.
- **Other platforms:** there is no Windows version.
