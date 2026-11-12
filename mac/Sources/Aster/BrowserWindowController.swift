// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
import AppKit
import AsterKit
import WebKit

private extension NSToolbarItem.Identifier {
    static let back = Self("back")
    static let forward = Self("forward")
    static let reload = Self("reload")
    static let address = Self("address")
    static let splitSearch = Self("splitSearch")
    static let cite = Self("cite")
    static let tools = Self("tools")
    static let bookmark = Self("bookmark")
    static let workspace = Self("workspace")
}

/// Aster's violet, from the flower in the app icon.
extension NSColor {
    static let asterAccent = NSColor(srgbRed: 0.431, green: 0.337, blue: 0.812, alpha: 1)
}

/// One browser tab. Tabs are native macOS window tabs, grouped per
/// workspace, so the tab bar, "+" button, drag-out and Show All Tabs all
/// behave like Safari's.
@MainActor
final class BrowserWindowController: NSWindowController, NSWindowDelegate, NSToolbarDelegate, NSTextFieldDelegate, NSMenuItemValidation, ToolsPanelOwner {
    private(set) static var all: [BrowserWindowController] = []
    static let toolsWidth: CGFloat = 360

    let context: BrowsingContext
    let pane: BrowserPane
    let tools: ToolsPanel
    /// Page on the left, Study Tools on the right. NSSplitViewController owns
    /// collapsing and expanding, so the sidebar always gets a real width.
    private let splitController = NSSplitViewController()
    private var toolsItem: NSSplitViewItem!
    private let addressField = AddressField()
    private var pageContainer: PageContainer!
    private var editingAddress = false
    private var toolbarButtons: [NSToolbarItem.Identifier: NSToolbarItem] = [:]
    private(set) lazy var findBar = FindBar(webView: pane.webView)
    private var dataObserver: NSObjectProtocol?
    private var starredKey: String?
    private var startPageHTML: String?

    /// Text for the address bar: empty on the Start page.
    private var displayAddress: String {
        StartPage.isStartPage(pane.webView.url) ? "" : AddressInput.display(pane.webView.url)
    }

    var hostWindow: NSWindow? { window }

    // MARK: Creating tabs and windows

    /// Opens a new window, or a tab in `tabbedWith`'s window.
    @discardableResult
    static func open(context: BrowsingContext, url: URL? = nil, tabbedWith host: NSWindow? = nil,
                     configuration: WKWebViewConfiguration? = nil, focus: Bool = true) -> BrowserWindowController {
        let controller = BrowserWindowController(context: context, configuration: configuration)
        all.append(controller)
        if let host, let window = controller.window {
            host.addTabbedWindow(window, ordered: .above)
            if focus { window.makeKeyAndOrderFront(nil) }
        } else {
            controller.window?.center()
            controller.showWindow(nil)
            // Show the tab bar even with a single tab, as in Aster's design.
            if let window = controller.window, window.tabGroup?.isTabBarVisible == false { window.toggleTabBar(nil) }
        }
        if let url {
            controller.pane.load(url)
        } else if configuration == nil {
            controller.showStartPage()
            controller.focusAddressBar()
        }
        return controller
    }

    private init(context: BrowsingContext, configuration: WKWebViewConfiguration?) {
        self.context = context
        pane = BrowserPane(context: context, configuration: configuration)
        tools = ToolsPanel(owner: nil)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.minSize = NSSize(width: 520, height: 360)
        window.tabbingMode = .automatic
        window.tabbingIdentifier = context.tabbingIdentifier
        window.titleVisibility = .hidden
        window.toolbarStyle = .unified
        window.subtitle = context.name
        window.isReleasedWhenClosed = false
        if context.isPrivate { window.appearance = NSAppearance(named: .darkAqua) }
        super.init(window: window)
        window.delegate = self
        tools.owner = self
        buildContent()
        buildToolbar()
        pane.onChange = { [weak self] in self?.refresh() }
        pane.openInNewTab = { [weak self] url in self?.openInNewTab(url) }
        pane.createTab = { [weak self] configuration in
            guard let self else { return nil }
            return Self.open(context: self.context, tabbedWith: self.window, configuration: configuration).pane.webView
        }
        pane.onCloseRequest = { [weak self] in self?.window?.performClose(nil) }
        dataObserver = NotificationCenter.default.addObserver(forName: .asterToolsDataDidChange, object: nil, queue: .main) { [weak self] note in
            let key = note.userInfo?["key"] as? String
            MainActor.assumeIsolated {
                if key == BookmarkFile.storageKey { self?.refreshBookmarkStar(force: true) }
                // Keep an open Start page's bookmarks and Today summary current.
                if key == BookmarkFile.storageKey || key == "glance" { self?.refreshStartPageIfShown() }
            }
        }
        tools.load()
        refresh()
    }

    required init?(coder: NSCoder) { nil }

    private func buildContent() {
        // The find bar sits above the page and is hidden until ⌘F.
        let pageController = NSViewController()
        pageContainer = PageContainer(findBar: findBar.view, page: pane.webView)
        pageController.view = pageContainer
        let pageItem = NSSplitViewItem(viewController: pageController)
        pageItem.minimumThickness = 320
        pageItem.holdingPriority = .defaultLow

        // The sidebar sits on a translucent macOS sidebar material; the tools
        // page draws a light tint over it.
        let toolsController = NSViewController()
        let material = NSVisualEffectView()
        material.material = .sidebar
        material.blendingMode = .behindWindow
        material.state = .followsWindowActiveState
        tools.webView.frame = material.bounds
        tools.webView.autoresizingMask = [.width, .height]
        material.addSubview(tools.webView)
        if tools.webView.responds(to: NSSelectorFromString("_setDrawsBackground:")) || tools.webView.responds(to: NSSelectorFromString("setDrawsBackground:")) {
            tools.webView.setValue(false, forKey: "drawsBackground")
        }
        toolsController.view = material
        toolsItem = NSSplitViewItem(viewController: toolsController)
        toolsItem.canCollapse = true
        toolsItem.minimumThickness = 300
        toolsItem.maximumThickness = 560
        toolsItem.holdingPriority = NSLayoutConstraint.Priority(260)
        // The sidebar is part of Aster's design, so it starts open until the user hides it.
        toolsItem.isCollapsed = !(UserDefaults.standard.object(forKey: "toolsVisible") as? Bool ?? true)

        splitController.splitView.isVertical = true
        splitController.splitView.dividerStyle = .thin
        splitController.addSplitViewItem(pageItem)
        splitController.addSplitViewItem(toolsItem)
        // Assigning a content view controller resizes the window to the
        // controller's view; keep the intended window size.
        let frame = window?.frame ?? .zero
        window?.contentViewController = splitController
        window?.setFrame(frame, display: false)
        if !toolsItem.isCollapsed {
            DispatchQueue.main.async { [weak self] in self?.positionTools() }
        }
    }

    /// Gives a freshly opened sidebar its usual width.
    private func positionTools() {
        let splitView = splitController.splitView
        splitView.layoutSubtreeIfNeeded()
        guard !toolsItem.isCollapsed, tools.webView.frame.width < Self.toolsWidth - 10 else { return }
        splitView.setPosition(max(320, splitView.bounds.width - Self.toolsWidth), ofDividerAt: 0)
    }

    // MARK: Toolbar

    private func buildToolbar() {
        // A new identifier so layouts saved by 0.3.0 don't hide the bookmark star.
        let toolbar = NSToolbar(identifier: "AsterBrowser.3")
        toolbar.delegate = self
        toolbar.displayMode = .iconOnly
        toolbar.allowsUserCustomization = true
        toolbar.autosavesConfiguration = true
        window?.toolbar = toolbar
    }

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.back, .forward, .reload, .workspace, .flexibleSpace, .address, .bookmark, .flexibleSpace, .splitSearch, .cite, .tools]
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.back, .forward, .reload, .workspace, .address, .bookmark, .splitSearch, .cite, .tools, .flexibleSpace, .space]
    }

    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier identifier: NSToolbarItem.Identifier,
                 willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        let button: (String, String, Selector) -> NSToolbarItem = { symbol, label, action in
            let item = NSToolbarItem(itemIdentifier: identifier)
            item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
            item.label = label
            item.toolTip = label
            // App-level actions travel up the responder chain to AppDelegate.
            item.target = self.responds(to: action) ? self : nil
            item.action = action
            item.isBordered = true
            item.autovalidates = false
            // Keep the sidebar, star and history buttons out of the » overflow on small screens.
            if [.tools, .bookmark, .back, .forward].contains(identifier) { item.visibilityPriority = .high }
            self.toolbarButtons[identifier] = item
            return item
        }
        switch identifier {
        case .back: return button("chevron.backward", "Back", #selector(goBack(_:)))
        case .forward: return button("chevron.forward", "Forward", #selector(goForward(_:)))
        case .reload: return button("arrow.clockwise", "Reload", #selector(reloadOrStop(_:)))
        case .splitSearch: return button("rectangle.split.2x1", "Split Search", #selector(AppDelegate.openSplitSearch(_:)))
        case .cite: return button("quote.bubble", "Cite This Page", #selector(citeThisPage(_:)))
        case .workspace:
            let item = NSToolbarItem(itemIdentifier: identifier)
            let button = NSButton(title: context.name, target: self, action: #selector(showWorkspaceMenu(_:)))
            button.bezelStyle = .texturedRounded
            // Palette colours survive the toolbar's own tinting of template images.
            let symbol = NSImage.SymbolConfiguration(pointSize: context.isPrivate ? 11 : 7, weight: .regular)
                .applying(.init(paletteColors: [context.isPrivate ? .secondaryLabelColor : .asterAccent]))
            button.image = NSImage(systemSymbolName: context.isPrivate ? "eye.slash" : "circle.fill", accessibilityDescription: nil)?
                .withSymbolConfiguration(symbol)
            button.imagePosition = .imageLeading
            button.font = .systemFont(ofSize: NSFont.smallSystemFontSize, weight: .medium)
            button.toolTip = context.isPrivate ? "Private window" : "Workspace: \(context.name). Click to open another workspace."
            button.setAccessibilityLabel("Workspace: \(context.name)")
            item.view = button
            item.label = "Workspace"
            return item
        case .bookmark:
            let item = button("star", "Bookmark This Page", #selector(toggleBookmark(_:)))
            DispatchQueue.main.async { [weak self] in self?.refreshBookmarkStar(force: true) }
            return item
        case .tools:
            let item = button("sidebar.right", "Study Tools", #selector(toggleTools(_:)))
            DispatchQueue.main.async { [weak self] in self?.refreshToolsButton() }
            return item
        case .address:
            let item = NSToolbarItem(itemIdentifier: identifier)
            addressField.placeholderString = context.isPrivate ? "Private: search or enter website" : "Search or enter website"
            addressField.bezelStyle = .roundedBezel
            addressField.lineBreakMode = .byTruncatingTail
            addressField.usesSingleLineMode = true
            addressField.cell?.isScrollable = true
            addressField.delegate = self
            addressField.target = self
            addressField.action = #selector(addressEntered(_:))
            addressField.translatesAutoresizingMaskIntoConstraints = false
            let wide = addressField.widthAnchor.constraint(equalToConstant: 520)
            wide.priority = .defaultLow
            NSLayoutConstraint.activate([wide, addressField.widthAnchor.constraint(greaterThanOrEqualToConstant: 220),
                                         addressField.widthAnchor.constraint(lessThanOrEqualToConstant: 900)])
            item.view = addressField
            item.label = "Address"
            item.visibilityPriority = .high
            return item
        default: return nil
        }
    }

    private func refresh() {
        let webView = pane.webView
        let title = webView.title.flatMap { $0.isEmpty ? nil : $0 } ?? displayAddress
        window?.title = title.isEmpty ? "New Tab" : title
        window?.tab.title = window?.title ?? ""
        if !editingAddress { addressField.stringValue = displayAddress }
        toolbarButtons[.back]?.isEnabled = webView.canGoBack
        toolbarButtons[.forward]?.isEnabled = webView.canGoForward
        let reload = toolbarButtons[.reload]
        reload?.image = NSImage(systemSymbolName: webView.isLoading ? "xmark" : "arrow.clockwise", accessibilityDescription: nil)
        reload?.label = webView.isLoading ? "Stop" : "Reload"
        reload?.toolTip = reload?.label
        pageContainer?.setProgress(webView.estimatedProgress, loading: webView.isLoading)
        refreshBookmarkStar()
    }

    // MARK: Start page and workspaces

    /// Shows the Start page (search box and bookmark tiles) in this tab.
    func showStartPage() {
        startPageHTML = startPageMarkup()
        pane.load(StartPage.url)
    }

    private func startPageMarkup() -> String {
        StartPageSchemeHandler.html(workspaceName: context.name, isPrivate: context.isPrivate)
    }

    /// Reloads the Start page when it is showing and its content changed.
    private func refreshStartPageIfShown() {
        guard StartPage.isStartPage(pane.webView.url), !pane.webView.isLoading else { return }
        let html = startPageMarkup()
        guard html != startPageHTML else { return }
        startPageHTML = html
        pane.webView.reload()
    }

    @objc private func showWorkspaceMenu(_ sender: NSButton) {
        let menu = NSMenu()
        let heading = NSMenuItem(title: "Open a new window in…", action: nil, keyEquivalent: "")
        heading.isEnabled = false
        menu.addItem(heading)
        for workspace in Workspace.defaults {
            let item = NSMenuItem(title: workspace.name, action: #selector(AppDelegate.newWorkspaceWindow(_:)), keyEquivalent: "")
            item.representedObject = workspace.id
            item.state = workspace.id == context.id ? .on : .off
            menu.addItem(item)
        }
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "New Private Window", action: #selector(AppDelegate.newPrivateWindow(_:)), keyEquivalent: ""))
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: sender.bounds.height + 4), in: sender)
    }

    // MARK: Bookmarks

    private var bookmarkFile: BookmarkFile { BookmarkFile(store: ToolsHub.shared.store) }

    private var pageIsBookmarkable: Bool {
        guard let url = pane.webView.url else { return false }
        return BookmarkFile.key(url) != nil
    }

    /// Fills the star when this page is bookmarked. Reads the file only when
    /// the page changes or bookmarks were edited.
    private func refreshBookmarkStar(force: Bool = false) {
        let key = pane.webView.url.flatMap(BookmarkFile.key)
        guard force || key != starredKey else { return }
        starredKey = key
        let starred = pane.webView.url.map(bookmarkFile.contains) ?? false
        let item = toolbarButtons[.bookmark]
        item?.image = NSImage(systemSymbolName: starred ? "star.fill" : "star", accessibilityDescription: starred ? "Remove Bookmark" : "Bookmark This Page")
        item?.label = starred ? "Remove Bookmark" : "Bookmark This Page"
        item?.toolTip = starred ? "Remove Bookmark (⌘D)" : "Bookmark This Page (⌘D)"
        item?.isEnabled = key != nil
    }

    /// ⌘D and the star: bookmarks the page, or removes its bookmark.
    @IBAction func toggleBookmark(_ sender: Any?) {
        guard let url = pane.webView.url else { return }
        do {
            let file = bookmarkFile
            if file.contains(url) {
                try file.remove(url: url)
            } else {
                try file.add(url: url, title: pane.webView.title ?? "")
            }
            ToolsHub.shared.didSave(BookmarkFile.storageKey, from: nil)
        } catch {
            let alert = NSAlert()
            alert.messageText = "Can't change bookmarks"
            alert.informativeText = error.localizedDescription
            if let window { alert.beginSheetModal(for: window, completionHandler: nil) } else { alert.runModal() }
        }
    }

    @IBAction func showBookmarks(_ sender: Any?) {
        setToolsVisible(true)
        tools.show(view: "bookmarks")
    }

    /// Bookmarks menu items open in the current tab, as in Safari.
    @IBAction func openBookmark(_ sender: NSMenuItem) {
        guard let url = sender.representedObject as? URL else { return }
        pane.load(url)
        window?.makeFirstResponder(pane.webView)
    }

    // MARK: Find in page

    @IBAction func showFindBar(_ sender: Any?) { findBar.show() }
    @IBAction func asterFindNext(_ sender: Any?) { findBar.findNext(sender) }
    @IBAction func asterFindPrevious(_ sender: Any?) { findBar.findPrevious(sender) }

    // MARK: Address bar

    @objc private func addressEntered(_ sender: NSTextField) {
        let provider = AppDelegate.shared.searchProvider
        guard let url = AddressInput.resolve(sender.stringValue, provider: provider) else { return }
        editingAddress = false
        pane.load(url)
        window?.makeFirstResponder(pane.webView)
    }

    func controlTextDidBeginEditing(_ notification: Notification) { editingAddress = true }

    func controlTextDidEndEditing(_ notification: Notification) {
        editingAddress = false
        refresh()
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        if selector == #selector(NSResponder.cancelOperation(_:)) {
            editingAddress = false
            addressField.stringValue = displayAddress
            window?.makeFirstResponder(pane.webView)
            return true
        }
        return false
    }

    func focusAddressBar() {
        window?.makeFirstResponder(addressField)
        addressField.currentEditor()?.selectAll(nil)
    }

    // MARK: Actions (also reached from the menu bar through the responder chain)

    @IBAction func goBack(_ sender: Any?) { pane.webView.goBack() }
    @IBAction func goForward(_ sender: Any?) { pane.webView.goForward() }
    @IBAction func reloadOrStop(_ sender: Any?) {
        if pane.webView.isLoading { pane.webView.stopLoading() } else { pane.webView.reload() }
    }
    @IBAction func reloadPage(_ sender: Any?) { pane.webView.reload() }

    @IBAction func printPage(_ sender: Any?) {
        guard let window else { return }
        let info = (NSPrintInfo.shared.copy() as? NSPrintInfo) ?? NSPrintInfo()
        info.horizontalPagination = .automatic
        info.verticalPagination = .automatic
        info.isHorizontallyCentered = false
        let operation = pane.webView.printOperation(with: info)
        // WebKit prints blank pages unless the operation's view has a frame.
        operation.view?.frame = pane.webView.bounds
        operation.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
    }
    @IBAction func openLocation(_ sender: Any?) { focusAddressBar() }
    @IBAction func newTab(_ sender: Any?) { Self.open(context: context, tabbedWith: window) }
    override func newWindowForTab(_ sender: Any?) { newTab(sender) }
    @IBAction func asterZoomIn(_ sender: Any?) { pane.webView.pageZoom = min(3, pane.webView.pageZoom + 0.1) }
    @IBAction func asterZoomOut(_ sender: Any?) { pane.webView.pageZoom = max(0.3, pane.webView.pageZoom - 0.1) }
    @IBAction func asterActualSize(_ sender: Any?) { pane.webView.pageZoom = 1 }

    @IBAction func toggleTools(_ sender: Any?) { setToolsVisible(toolsItem.isCollapsed) }

    /// Shows or hides the sidebar in every tab and window, so switching tabs
    /// never brings back a sidebar you just closed.
    func setToolsVisible(_ visible: Bool) {
        UserDefaults.standard.set(visible, forKey: "toolsVisible")
        for controller in Self.all { controller.applyToolsVisible(visible) }
        if !Self.all.contains(where: { $0 === self }) { applyToolsVisible(visible) }
    }

    private func applyToolsVisible(_ visible: Bool) {
        guard toolsItem.isCollapsed == visible else { return }
        toolsItem.isCollapsed = !visible
        if visible { positionTools() }
        refreshToolsButton()
    }

    /// The sidebar button is violet while the sidebar is open.
    private func refreshToolsButton() {
        guard let item = toolbarButtons[.tools] else { return }
        let open = !toolsItem.isCollapsed
        let symbol = NSImage.SymbolConfiguration(pointSize: 13, weight: .regular)
            .applying(.init(paletteColors: [open ? .asterAccent : .labelColor]))
        item.image = NSImage(systemSymbolName: "sidebar.right", accessibilityDescription: open ? "Hide Study Tools" : "Show Study Tools")?
            .withSymbolConfiguration(symbol)
        item.label = open ? "Hide Study Tools" : "Study Tools"
        item.toolTip = open ? "Hide Study Tools (⌥⌘S)" : "Show Study Tools (⌥⌘S)"
    }

    @IBAction func citeThisPage(_ sender: Any?) {
        Task { @MainActor in
            do {
                let metadata = try await extractCitation()
                setToolsVisible(true)
                tools.receiveCitation(metadata)
            } catch {
                let alert = NSAlert()
                alert.messageText = "Can't cite this page"
                alert.informativeText = error.localizedDescription
                if let window { alert.beginSheetModal(for: window, completionHandler: nil) } else { alert.runModal() }
            }
        }
    }

    @IBAction func showStudyTool(_ sender: NSMenuItem) {
        guard let view = sender.representedObject as? String else { return }
        setToolsVisible(true)
        tools.show(view: view)
    }

    /// Widths of the page and the sidebar, for the self-test.
    var layoutWidths: (page: CGFloat, tools: CGFloat) {
        splitController.splitView.layoutSubtreeIfNeeded()
        let page = splitController.splitViewItems[0].viewController.view.frame.width
        return (page, toolsItem.isCollapsed ? 0 : tools.webView.frame.width)
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        switch item.action {
        case #selector(goBack(_:)): return pane.webView.canGoBack
        case #selector(goForward(_:)): return pane.webView.canGoForward
        case #selector(toggleBookmark(_:)):
            item.title = pane.webView.url.map(bookmarkFile.contains) == true ? "Remove Bookmark" : "Bookmark This Page"
            return pageIsBookmarkable
        case #selector(asterFindNext(_:)), #selector(asterFindPrevious(_:)):
            return !findBar.query.isEmpty || findBar.isVisible
        case #selector(toggleTools(_:)):
            item.title = toolsItem.isCollapsed ? "Show Study Tools" : "Hide Study Tools"
            return true
        default: return true
        }
    }

    // MARK: ToolsPanelOwner

    func extractCitation() async throws -> [String: Any] {
        try await CitationRunner.extract(from: pane.webView)
    }

    func currentPage() throws -> [String: Any] {
        guard let url = pane.webView.url, BookmarkFile.key(url) != nil else {
            throw ToolsError(message: "Open a web page first.")
        }
        return ["url": url.absoluteString, "title": pane.webView.title ?? ""]
    }

    func openInNewTab(_ url: URL) {
        Self.open(context: context, url: url, tabbedWith: window, focus: false)
    }

    // MARK: Window lifecycle

    func windowDidBecomeKey(_ notification: Notification) {
        if !context.isPrivate { UserDefaults.standard.set(context.id, forKey: "lastWorkspace") }
    }

    func windowWillClose(_ notification: Notification) {
        // Remember the page for History → Reopen Closed Tab (never for private windows).
        if !context.isPrivate, let url = pane.webView.url, BookmarkFile.key(url) != nil {
            AppDelegate.shared.rememberClosedTab(url: url, workspaceId: context.id)
        }
        pane.webView.stopLoading()
        pane.onChange = nil
        if let dataObserver { NotificationCenter.default.removeObserver(dataObserver) }
        Self.all.removeAll { $0 === self }
    }
}

/// Puts the find bar (when shown) above the web page.
final class PageContainer: NSView {
    private let findBar: NSView
    private let page: NSView
    /// A thin loading bar along the top edge, drawn over the page.
    private let progressLine = NSView()
    private var progress: Double = 0

    init(findBar: NSView, page: NSView) {
        self.findBar = findBar
        self.page = page
        super.init(frame: .zero)
        findBar.translatesAutoresizingMaskIntoConstraints = true
        page.translatesAutoresizingMaskIntoConstraints = true
        addSubview(page)
        addSubview(findBar)
        progressLine.wantsLayer = true
        progressLine.layer?.backgroundColor = NSColor.asterAccent.cgColor
        progressLine.isHidden = true
        addSubview(progressLine)
    }

    func setProgress(_ value: Double, loading: Bool) {
        progress = max(0.05, min(1, value))
        progressLine.isHidden = !loading
        needsLayout = true
    }

    required init?(coder: NSCoder) { nil }

    override var isFlipped: Bool { true }

    override func layout() {
        super.layout()
        let barHeight = findBar.isHidden ? 0 : ceil(findBar.fittingSize.height)
        findBar.frame = NSRect(x: 0, y: 0, width: bounds.width, height: barHeight)
        page.frame = NSRect(x: 0, y: barHeight, width: bounds.width, height: max(0, bounds.height - barHeight))
        progressLine.frame = NSRect(x: 0, y: 0, width: bounds.width * progress, height: 2)
    }
}

/// The address bar. One click selects the whole address, as in Safari, so
/// typing replaces it instead of inserting into the middle of a URL.
final class AddressField: NSTextField {
    override func mouseDown(with event: NSEvent) {
        let wasEditing = currentEditor() != nil
        super.mouseDown(with: event)
        if !wasEditing { currentEditor()?.selectAll(nil) }
    }
}
