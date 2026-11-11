// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
import AppKit
import AsterKit
import WebKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuItemValidation, NSMenuDelegate {
    static var shared: AppDelegate { NSApp.delegate as! AppDelegate }
    private var launched = false
    private var pendingURLs: [URL] = []

    var searchProvider: SearchProvider {
        SearchProvider.provider(id: UserDefaults.standard.string(forKey: "searchProvider"))
    }

    /// The workspace of the frontmost browser window, else the last one used.
    var currentContext: BrowsingContext {
        if let controller = NSApp.keyWindow?.windowController as? BrowserWindowController { return controller.context }
        if let controller = NSApp.keyWindow?.windowController as? SplitSearchWindowController { return controller.context }
        let id = UserDefaults.standard.string(forKey: "lastWorkspace")
        return .workspace(Workspace.defaults.first { $0.id == id } ?? Workspace.defaults[0])
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let arguments = CommandLine.arguments
        if arguments.contains("--self-test") {
            SelfTest.start()
            return
        }
        NSApp.mainMenu = makeMainMenu()
        launched = true
        // --open <url> and --show-tools are used for CI screenshots.
        var urls = pendingURLs
        if let index = arguments.firstIndex(of: "--open"), index + 1 < arguments.count, let url = URL(string: arguments[index + 1]) {
            urls.append(url)
        }
        pendingURLs = []
        let first = BrowserWindowController.open(context: currentContext, url: urls.first)
        for url in urls.dropFirst() { BrowserWindowController.open(context: first.context, url: url, tabbedWith: first.window, focus: false) }
        if arguments.contains("--show-tools") { first.setToolsVisible(true) }
        activateApp()
    }

    /// Links opened from other apps when Aster is the default browser.
    func application(_ application: NSApplication, open urls: [URL]) {
        let web = urls.filter { ["http", "https"].contains($0.scheme?.lowercased() ?? "") }
        guard launched else { pendingURLs.append(contentsOf: web); return }
        for url in web {
            let host = (NSApp.keyWindow?.windowController as? BrowserWindowController) ?? BrowserWindowController.all.last
            BrowserWindowController.open(context: host?.context ?? currentContext, url: url, tabbedWith: host?.window)
        }
        activateApp()
    }

    private func activateApp() {
        if #available(macOS 14, *) { NSApp.activate() } else { NSApp.activate(ignoringOtherApps: true) }
    }

    // MARK: Reopen closed tab

    private var closedTabs: [(url: URL, workspaceId: String)] = []

    func rememberClosedTab(url: URL, workspaceId: String) {
        closedTabs.append((url, workspaceId))
        if closedTabs.count > 25 { closedTabs.removeFirst() }
    }

    @IBAction func reopenClosedTab(_ sender: Any?) {
        guard let last = closedTabs.popLast() else { return }
        let workspace = Workspace.defaults.first { $0.id == last.workspaceId } ?? Workspace.defaults[0]
        let context = BrowsingContext.workspace(workspace)
        let host = BrowserWindowController.all.last { $0.context === context && $0.window?.isVisible == true }
        BrowserWindowController.open(context: context, url: last.url, tabbedWith: host?.window)
    }

    @IBAction func showDownloads(_ sender: Any?) {
        if let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first {
            NSWorkspace.shared.open(folder)
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { BrowserWindowController.open(context: currentContext) }
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    // MARK: Actions

    @IBAction func newWindow(_ sender: Any?) { BrowserWindowController.open(context: currentContext) }

    @IBAction func newPrivateWindow(_ sender: Any?) { BrowserWindowController.open(context: .makePrivate()) }

    @IBAction func newWorkspaceWindow(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String, let workspace = Workspace.defaults.first(where: { $0.id == id }) else { return }
        BrowserWindowController.open(context: .workspace(workspace))
    }

    @IBAction func openSplitSearch(_ sender: Any?) {
        var query = ""
        if let controller = NSApp.keyWindow?.windowController as? BrowserWindowController,
           let url = controller.pane.webView.url, !url.absoluteString.hasPrefix("about:") {
            query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "q" || $0.name == "p" }?.value ?? ""
        }
        SplitSearchWindowController.open(context: currentContext, query: query)
    }

    @IBAction func selectSearchEngine(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        UserDefaults.standard.set(id, forKey: "searchProvider")
    }

    @IBAction func clearWorkspaceData(_ sender: Any?) {
        let context = currentContext
        guard !context.isPrivate else { return }
        let alert = NSAlert()
        alert.messageText = "Clear website data for \(context.name)?"
        alert.informativeText = "This signs you out of websites and removes cookies, caches and site data in the \(context.name) workspace. Other workspaces and your study tools are not affected."
        alert.addButton(withTitle: "Clear")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        Task { @MainActor in await context.clearWebsiteData() }
    }

    @IBAction func setAsDefaultBrowser(_ sender: Any?) {
        Task { @MainActor in
            do {
                for scheme in ["http", "https"] {
                    try await NSWorkspace.shared.setDefaultApplication(at: Bundle.main.bundleURL, toOpenURLsWithScheme: scheme)
                }
            } catch {
                let alert = NSAlert()
                alert.messageText = "Aster could not be made the default browser"
                alert.informativeText = error.localizedDescription
                alert.runModal()
            }
        }
    }

    /// Used when no browser window is in front; windows handle it themselves otherwise.
    @IBAction func openBookmark(_ sender: NSMenuItem) {
        guard let url = sender.representedObject as? URL else { return }
        BrowserWindowController.open(context: currentContext, url: url)
    }

    // MARK: Bookmarks menu

    private static let fixedBookmarkItems = 3
    private static let maxBookmarkItems = 300

    /// Rebuilt every time the Bookmarks menu opens, so it always matches the file.
    func menuNeedsUpdate(_ menu: NSMenu) {
        while menu.items.count > Self.fixedBookmarkItems { menu.removeItem(at: Self.fixedBookmarkItems) }
        let contents: BookmarkFile.Contents
        do {
            contents = try BookmarkFile(store: ToolsHub.shared.store).read()
        } catch {
            menu.addItem(NSMenuItem(title: "Bookmarks can't be read", action: nil, keyEquivalent: ""))
            return
        }
        if contents.bookmarks.isEmpty {
            menu.addItem(NSMenuItem(title: "No Bookmarks", action: nil, keyEquivalent: ""))
            return
        }
        var budget = Self.maxBookmarkItems
        func entry(_ bookmark: BookmarkFile.Bookmark) -> NSMenuItem {
            let title = bookmark.title.count > 60 ? String(bookmark.title.prefix(59)) + "…" : bookmark.title
            let item = NSMenuItem(title: title, action: #selector(openBookmark(_:)), keyEquivalent: "")
            item.representedObject = bookmark.url
            item.toolTip = bookmark.url.absoluteString
            return item
        }
        let folderIds = Set(contents.folders.map(\.id))
        for folder in contents.folders {
            let items = contents.bookmarks.filter { $0.folderId == folder.id }
            let submenu = NSMenu(title: folder.name)
            for bookmark in items.prefix(budget) { submenu.addItem(entry(bookmark)) }
            budget -= min(budget, items.count)
            if items.isEmpty { submenu.addItem(NSMenuItem(title: "Empty", action: nil, keyEquivalent: "")) }
            let holder = NSMenuItem(title: folder.name, action: nil, keyEquivalent: "")
            holder.image = NSImage(systemSymbolName: "folder", accessibilityDescription: nil)
            holder.submenu = submenu
            menu.addItem(holder)
        }
        let unfiled = contents.bookmarks.filter { $0.folderId == nil || !folderIds.contains($0.folderId!) }
        if !contents.folders.isEmpty && !unfiled.isEmpty { menu.addItem(.separator()) }
        for bookmark in unfiled.prefix(budget) { menu.addItem(entry(bookmark)) }
        if contents.bookmarks.count > Self.maxBookmarkItems {
            menu.addItem(.separator())
            menu.addItem(NSMenuItem(title: "More in Study Tools…", action: #selector(BrowserWindowController.showBookmarks(_:)), keyEquivalent: ""))
        }
    }

    @IBAction func showHelp(_ sender: Any?) {
        BrowserWindowController.open(context: currentContext, url: URL(string: "https://github.com/Sumi1124/browser#readme"))
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        if item.action == #selector(reopenClosedTab(_:)) { return !closedTabs.isEmpty }
        if item.action == #selector(selectSearchEngine(_:)) {
            item.state = (item.representedObject as? String) == searchProvider.id ? .on : .off
        }
        if item.action == #selector(clearWorkspaceData(_:)) {
            let context = currentContext
            item.title = context.isPrivate ? "Clear Website Data…" : "Clear Website Data for \(context.name)…"
            return !context.isPrivate
        }
        return true
    }

    // MARK: Menu bar

    private func makeMainMenu() -> NSMenu {
        let main = NSMenu()
        func submenu(_ title: String, _ items: [NSMenuItem]) {
            let menu = NSMenu(title: title)
            items.forEach(menu.addItem)
            let holder = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            holder.submenu = menu
            main.addItem(holder)
        }
        func item(_ title: String, _ action: Selector?, _ key: String = "", _ modifiers: NSEvent.ModifierFlags = .command,
                  represented: Any? = nil) -> NSMenuItem {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
            item.keyEquivalentModifierMask = modifiers
            item.representedObject = represented
            return item
        }

        let engines = NSMenu(title: "Search Engine")
        for provider in SearchProvider.all {
            engines.addItem(item(provider.name, #selector(selectSearchEngine(_:)), represented: provider.id))
        }
        let engineItem = NSMenuItem(title: "Search Engine", action: nil, keyEquivalent: "")
        engineItem.submenu = engines

        submenu("Aster", [
            item("About Aster", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
            .separator(),
            engineItem,
            item("Set as Default Browser…", #selector(setAsDefaultBrowser(_:))),
            .separator(),
            item("Hide Aster", #selector(NSApplication.hide(_:)), "h"),
            item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item("Show All", #selector(NSApplication.unhideAllApplications(_:))),
            .separator(),
            item("Quit Aster", #selector(NSApplication.terminate(_:)), "q"),
        ])
        submenu("File", [
            item("New Tab", #selector(BrowserWindowController.newTab(_:)), "t"),
            item("New Window", #selector(newWindow(_:)), "n"),
            item("New Private Window", #selector(newPrivateWindow(_:)), "n", [.command, .shift]),
            .separator(),
            item("Open Location…", #selector(BrowserWindowController.openLocation(_:)), "l"),
            item("Split Search…", #selector(openSplitSearch(_:)), "f", [.command, .option]),
            .separator(),
            item("Close Tab", #selector(NSWindow.performClose(_:)), "w"),
            .separator(),
            item("Print…", #selector(BrowserWindowController.printPage(_:)), "p"),
        ])
        submenu("Edit", [
            item("Undo", Selector(("undo:")), "z"),
            item("Redo", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            item("Cut", #selector(NSText.cut(_:)), "x"),
            item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Paste", #selector(NSText.paste(_:)), "v"),
            item("Select All", #selector(NSText.selectAll(_:)), "a"),
            .separator(),
            item("Find…", #selector(BrowserWindowController.showFindBar(_:)), "f"),
            item("Find Next", #selector(BrowserWindowController.asterFindNext(_:)), "g"),
            item("Find Previous", #selector(BrowserWindowController.asterFindPrevious(_:)), "g", [.command, .shift]),
        ])
        submenu("View", [
            item("Reload Page", #selector(BrowserWindowController.reloadPage(_:)), "r"),
            .separator(),
            item("Actual Size", #selector(BrowserWindowController.asterActualSize(_:)), "0"),
            item("Zoom In", #selector(BrowserWindowController.asterZoomIn(_:)), "+"),
            item("Zoom Out", #selector(BrowserWindowController.asterZoomOut(_:)), "-"),
            .separator(),
            item("Show Study Tools", #selector(BrowserWindowController.toggleTools(_:)), "s", [.command, .option]),
            item("Show Downloads", #selector(showDownloads(_:)), "l", [.command, .option]),
            .separator(),
            item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])
        submenu("History", [
            item("Back", #selector(BrowserWindowController.goBack(_:)), "["),
            item("Forward", #selector(BrowserWindowController.goForward(_:)), "]"),
            .separator(),
            item("Reopen Closed Tab", #selector(reopenClosedTab(_:)), "t", [.command, .shift]),
        ])
        submenu("Bookmarks", [
            item("Bookmark This Page", #selector(BrowserWindowController.toggleBookmark(_:)), "d"),
            item("Show All Bookmarks", #selector(BrowserWindowController.showBookmarks(_:)), "b", [.command, .option]),
            .separator(),
        ])
        main.item(withTitle: "Bookmarks")?.submenu?.delegate = self
        submenu("Study", [
            item("Cite This Page", #selector(BrowserWindowController.citeThisPage(_:)), "c", [.command, .option]),
            .separator(),
            item("Planner", #selector(BrowserWindowController.showStudyTool(_:)), "1", [.command, .option], represented: "planner"),
            item("Flashcards", #selector(BrowserWindowController.showStudyTool(_:)), "2", [.command, .option], represented: "cards"),
            item("Research Library", #selector(BrowserWindowController.showStudyTool(_:)), "3", [.command, .option], represented: "library"),
            item("Data and Charts", #selector(BrowserWindowController.showStudyTool(_:)), "4", [.command, .option], represented: "data"),
            item("Backup", #selector(BrowserWindowController.showStudyTool(_:)), "5", [.command, .option], represented: "backup"),
        ])
        var workspaceItems = Workspace.defaults.enumerated().map { index, workspace in
            item("New \(workspace.name) Window", #selector(newWorkspaceWindow(_:)), "\(index + 1)", [.command, .control], represented: workspace.id)
        }
        workspaceItems += [.separator(), item("Clear Website Data…", #selector(clearWorkspaceData(_:)))]
        submenu("Workspaces", workspaceItems)
        submenu("Window", [
            item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("Zoom", #selector(NSWindow.performZoom(_:))),
            .separator(),
            item("Bring All to Front", #selector(NSApplication.arrangeInFront(_:))),
        ])
        submenu("Help", [item("Aster Help", #selector(showHelp(_:)), "?")])
        NSApp.windowsMenu = main.item(withTitle: "Window")?.submenu
        NSApp.helpMenu = main.item(withTitle: "Help")?.submenu
        return main
    }
}
