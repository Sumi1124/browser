// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
import AppKit
import AsterKit
import WebKit

/// Searches two engines at once and shows the results side by side (or
/// stacked). Each side is a full web view: links, scrolling and history work
/// independently. Pages that open new windows open as tabs in a browser window.
@MainActor
final class SplitSearchWindowController: NSWindowController, NSWindowDelegate {
    private(set) static var all: [SplitSearchWindowController] = []

    let context: BrowsingContext
    let left: BrowserPane
    let right: BrowserPane
    private let queryField = NSSearchField()
    private let leftEngine = NSPopUpButton()
    private let rightEngine = NSPopUpButton()
    private let split = NSSplitView()

    static func open(context: BrowsingContext, query: String = "") {
        let controller = SplitSearchWindowController(context: context, query: query)
        all.append(controller)
        controller.window?.center()
        controller.showWindow(nil)
        controller.window?.makeFirstResponder(controller.queryField)
        if !query.isEmpty { controller.search(nil) }
    }

    private init(context: BrowsingContext, query: String) {
        self.context = context
        left = BrowserPane(context: context)
        right = BrowserPane(context: context)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1400, height: 860),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Split Search"
        window.subtitle = context.name
        window.tabbingMode = .disallowed
        window.isReleasedWhenClosed = false
        if context.isPrivate { window.appearance = NSAppearance(named: .darkAqua) }
        super.init(window: window)
        window.delegate = self

        let defaultId = AppDelegate.shared.searchProvider.id
        for (popup, preferred) in [(leftEngine, defaultId), (rightEngine, defaultId == "duckduckgo" ? "google" : "duckduckgo")] {
            popup.addItems(withTitles: SearchProvider.all.map(\.name))
            popup.selectItem(at: SearchProvider.all.firstIndex { $0.id == preferred } ?? 0)
            popup.target = self
            popup.action = #selector(search(_:))
        }
        queryField.placeholderString = "Search both engines"
        queryField.stringValue = query
        queryField.sendsSearchStringImmediately = false
        queryField.sendsWholeSearchString = true
        queryField.target = self
        queryField.action = #selector(search(_:))
        let swap = NSButton(image: NSImage(systemSymbolName: "arrow.left.arrow.right", accessibilityDescription: "Swap sides")!,
                            target: self, action: #selector(swapSides(_:)))
        swap.toolTip = "Swap sides"
        let layout = NSButton(image: NSImage(systemSymbolName: "rectangle.split.1x2", accessibilityDescription: "Stack or side by side")!,
                              target: self, action: #selector(toggleLayout(_:)))
        layout.toolTip = "Stack or side by side"
        let bar = NSStackView(views: [leftEngine, queryField, swap, layout, rightEngine])
        bar.orientation = .horizontal
        bar.spacing = 8
        bar.edgeInsets = NSEdgeInsets(top: 8, left: 10, bottom: 8, right: 10)
        queryField.setContentHuggingPriority(.defaultLow, for: .horizontal)

        split.isVertical = true
        split.dividerStyle = .thin
        split.addArrangedSubview(left.webView)
        split.addArrangedSubview(right.webView)

        let column = NSStackView(views: [bar, split])
        column.orientation = .vertical
        column.spacing = 0
        column.alignment = .leading
        bar.translatesAutoresizingMaskIntoConstraints = false
        split.translatesAutoresizingMaskIntoConstraints = false
        window.contentView = column
        NSLayoutConstraint.activate([
            bar.widthAnchor.constraint(equalTo: column.widthAnchor),
            split.widthAnchor.constraint(equalTo: column.widthAnchor),
        ])

        for pane in [left, right] {
            pane.openInNewTab = { [weak self] url in self?.openInBrowser(url) }
            pane.createTab = { [weak self] configuration in
                guard let self else { return nil }
                return BrowserWindowController.open(context: self.context, configuration: configuration).pane.webView
            }
        }
    }

    required init?(coder: NSCoder) { nil }

    private func equalize() {
        split.layoutSubtreeIfNeeded()
        let length = split.isVertical ? split.bounds.width : split.bounds.height
        split.setPosition(length / 2, ofDividerAt: 0)
    }

    @objc func search(_ sender: Any?) {
        let query = queryField.stringValue
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let providers = [leftEngine, rightEngine].map { SearchProvider.all[max(0, $0.indexOfSelectedItem)] }
        if let url = providers[0].url(for: query) { left.load(url) }
        if let url = providers[1].url(for: query) { right.load(url) }
        window?.title = "Split Search: \(query)"
        equalize()
    }

    @objc func swapSides(_ sender: Any?) {
        let index = leftEngine.indexOfSelectedItem
        leftEngine.selectItem(at: rightEngine.indexOfSelectedItem)
        rightEngine.selectItem(at: index)
        search(nil)
    }

    @objc func toggleLayout(_ sender: Any?) {
        split.isVertical.toggle()
        split.adjustSubviews()
        equalize()
    }

    private func openInBrowser(_ url: URL) {
        let host = BrowserWindowController.all.last { $0.context === context }?.window
        BrowserWindowController.open(context: context, url: url, tabbedWith: host)
    }

    func windowWillClose(_ notification: Notification) {
        Self.all.removeAll { $0 === self }
    }
}
