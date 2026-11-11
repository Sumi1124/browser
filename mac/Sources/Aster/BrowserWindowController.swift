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
    private let split = NSSplitView()
    private let addressField = NSTextField()
    private var editingAddress = false
    private var toolbarButtons: [NSToolbarItem.Identifier: NSToolbarItem] = [:]

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
        }
        if let url { controller.pane.load(url) } else if configuration == nil { controller.focusAddressBar() }
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
        tools.load()
        refresh()
    }

    required init?(coder: NSCoder) { nil }

    private func buildContent() {
        split.isVertical = true
        split.dividerStyle = .thin
        split.addArrangedSubview(pane.webView)
        split.addArrangedSubview(tools.webView)
        split.setHoldingPriority(.defaultLow, forSubviewAt: 0)
        split.setHoldingPriority(.defaultHigh, forSubviewAt: 1)
        tools.webView.isHidden = !UserDefaults.standard.bool(forKey: "toolsVisible")
        window?.contentView = split
        if !tools.webView.isHidden {
            DispatchQueue.main.async { [weak self] in self?.positionTools() }
        }
    }

    private func positionTools() {
        split.layoutSubtreeIfNeeded()
        split.setPosition(max(320, split.bounds.width - Self.toolsWidth), ofDividerAt: 0)
    }

    // MARK: Toolbar

    private func buildToolbar() {
        let toolbar = NSToolbar(identifier: "AsterBrowser")
        toolbar.delegate = self
        toolbar.displayMode = .iconOnly
        toolbar.allowsUserCustomization = true
        toolbar.autosavesConfiguration = true
        window?.toolbar = toolbar
    }

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.back, .forward, .reload, .flexibleSpace, .address, .flexibleSpace, .splitSearch, .cite, .tools]
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.back, .forward, .reload, .address, .splitSearch, .cite, .tools, .flexibleSpace, .space]
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
            self.toolbarButtons[identifier] = item
            return item
        }
        switch identifier {
        case .back: return button("chevron.backward", "Back", #selector(goBack(_:)))
        case .forward: return button("chevron.forward", "Forward", #selector(goForward(_:)))
        case .reload: return button("arrow.clockwise", "Reload", #selector(reloadOrStop(_:)))
        case .splitSearch: return button("rectangle.split.2x1", "Split Search", #selector(AppDelegate.openSplitSearch(_:)))
        case .cite: return button("quote.bubble", "Cite This Page", #selector(citeThisPage(_:)))
        case .tools: return button("sidebar.right", "Study Tools", #selector(toggleTools(_:)))
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
            let wide = addressField.widthAnchor.constraint(equalToConstant: 640)
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
        let title = webView.title.flatMap { $0.isEmpty ? nil : $0 } ?? AddressInput.display(webView.url)
        window?.title = title.isEmpty ? "New Tab" : title
        window?.tab.title = window?.title ?? ""
        if !editingAddress { addressField.stringValue = AddressInput.display(webView.url) }
        toolbarButtons[.back]?.isEnabled = webView.canGoBack
        toolbarButtons[.forward]?.isEnabled = webView.canGoForward
        let reload = toolbarButtons[.reload]
        reload?.image = NSImage(systemSymbolName: webView.isLoading ? "xmark" : "arrow.clockwise", accessibilityDescription: nil)
        reload?.label = webView.isLoading ? "Stop" : "Reload"
        reload?.toolTip = reload?.label
    }

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
            addressField.stringValue = AddressInput.display(pane.webView.url)
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
    @IBAction func openLocation(_ sender: Any?) { focusAddressBar() }
    @IBAction func newTab(_ sender: Any?) { Self.open(context: context, tabbedWith: window) }
    override func newWindowForTab(_ sender: Any?) { newTab(sender) }
    @IBAction func asterZoomIn(_ sender: Any?) { pane.webView.pageZoom = min(3, pane.webView.pageZoom + 0.1) }
    @IBAction func asterZoomOut(_ sender: Any?) { pane.webView.pageZoom = max(0.3, pane.webView.pageZoom - 0.1) }
    @IBAction func asterActualSize(_ sender: Any?) { pane.webView.pageZoom = 1 }

    @IBAction func toggleTools(_ sender: Any?) { setToolsVisible(tools.webView.isHidden) }

    func setToolsVisible(_ visible: Bool) {
        tools.webView.isHidden = !visible
        UserDefaults.standard.set(visible, forKey: "toolsVisible")
        split.adjustSubviews()
        if visible { positionTools() }
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
                if let window { alert.beginSheetModal(for: window) } else { alert.runModal() }
            }
        }
    }

    @IBAction func showStudyTool(_ sender: NSMenuItem) {
        guard let view = sender.representedObject as? String else { return }
        setToolsVisible(true)
        tools.show(view: view)
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        switch item.action {
        case #selector(goBack(_:)): return pane.webView.canGoBack
        case #selector(goForward(_:)): return pane.webView.canGoForward
        case #selector(toggleTools(_:)):
            item.title = tools.webView.isHidden ? "Show Study Tools" : "Hide Study Tools"
            return true
        default: return true
        }
    }

    // MARK: ToolsPanelOwner

    func extractCitation() async throws -> [String: Any] {
        try await CitationRunner.extract(from: pane.webView)
    }

    func openInNewTab(_ url: URL) {
        Self.open(context: context, url: url, tabbedWith: window, focus: false)
    }

    // MARK: Window lifecycle

    func windowDidBecomeKey(_ notification: Notification) {
        if !context.isPrivate { UserDefaults.standard.set(context.id, forKey: "lastWorkspace") }
    }

    func windowWillClose(_ notification: Notification) {
        pane.webView.stopLoading()
        pane.onChange = nil
        Self.all.removeAll { $0 === self }
    }
}
