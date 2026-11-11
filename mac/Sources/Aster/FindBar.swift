// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
import AppKit
import WebKit

/// Find in page: a bar above the web page (⌘F) with live search, a match
/// count, next/previous (⌘G / ⇧⌘G, Return / ⇧Return) and Esc to close.
/// Highlighting and scrolling use WebKit's own find; the count is computed
/// in an isolated JavaScript world the page cannot see or change.
@MainActor
final class FindBar: NSObject, NSSearchFieldDelegate {
    let view = NSStackView()
    private let field = NSSearchField()
    private let status = NSTextField(labelWithString: "")
    private weak var webView: WKWebView?
    private var generation = 0
    static let world = WKContentWorld.world(name: "AsterFind")

    init(webView: WKWebView) {
        self.webView = webView
        super.init()
        field.placeholderString = "Find on page"
        field.sendsSearchStringImmediately = true
        field.sendsWholeSearchString = false
        field.delegate = self
        field.target = self
        field.action = #selector(fieldAction(_:))
        field.setAccessibilityLabel("Find on page")
        status.textColor = .secondaryLabelColor
        status.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
        status.setContentHuggingPriority(.required, for: .horizontal)
        let previous = NSButton(image: NSImage(systemSymbolName: "chevron.up", accessibilityDescription: "Previous match")!,
                                target: self, action: #selector(findPrevious(_:)))
        let next = NSButton(image: NSImage(systemSymbolName: "chevron.down", accessibilityDescription: "Next match")!,
                            target: self, action: #selector(findNext(_:)))
        let done = NSButton(title: "Done", target: self, action: #selector(close(_:)))
        for button in [previous, next] { button.bezelStyle = .texturedRounded }
        previous.toolTip = "Previous match (⇧⌘G)"
        next.toolTip = "Next match (⌘G)"
        view.orientation = .horizontal
        view.spacing = 6
        view.edgeInsets = NSEdgeInsets(top: 6, left: 10, bottom: 6, right: 10)
        view.addArrangedSubview(field)
        view.addArrangedSubview(status)
        view.addArrangedSubview(previous)
        view.addArrangedSubview(next)
        view.addArrangedSubview(done)
        field.widthAnchor.constraint(greaterThanOrEqualToConstant: 220).isActive = true
        view.isHidden = true
    }

    var isVisible: Bool { !view.isHidden }
    var query: String { field.stringValue }

    func show() {
        view.isHidden = false
        view.superview?.needsLayout = true
        view.window?.makeFirstResponder(field)
        field.currentEditor()?.selectAll(nil)
        if !field.stringValue.isEmpty { search(backwards: false) }
    }

    @objc func close(_ sender: Any?) {
        view.isHidden = true
        view.superview?.needsLayout = true
        status.stringValue = ""
        if let webView {
            // Searching for an empty string clears WebKit's highlight.
            webView.find("", configuration: WKFindConfiguration()) { _ in }
            webView.window?.makeFirstResponder(webView)
        }
    }

    @objc func findNext(_ sender: Any?) {
        if view.isHidden { show() } else { search(backwards: false) }
    }

    @objc func findPrevious(_ sender: Any?) {
        if view.isHidden { show() } else { search(backwards: true) }
    }

    @objc private func fieldAction(_ sender: Any?) {
        search(backwards: NSApp.currentEvent?.modifierFlags.contains(.shift) == true)
    }

    func controlTextDidChange(_ notification: Notification) {
        search(backwards: false)
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        if selector == #selector(NSResponder.cancelOperation(_:)) {
            close(nil)
            return true
        }
        return false
    }

    /// Searches and reports the result; also used by the self-test.
    func search(backwards: Bool, completion: ((Bool, Int) -> Void)? = nil) {
        guard let webView else { return }
        let text = field.stringValue
        generation += 1
        let current = generation
        guard !text.isEmpty else {
            status.stringValue = ""
            completion?(false, 0)
            return
        }
        let configuration = WKFindConfiguration()
        configuration.backwards = backwards
        configuration.caseSensitive = false
        configuration.wraps = true
        webView.find(text, configuration: configuration) { [weak self] result in
            guard let self, current == self.generation else { return }
            Task { @MainActor in
                let count = (try? await Self.countMatches(of: text, in: webView)) ?? 0
                guard current == self.generation else { return }
                if result.matchFound {
                    self.status.stringValue = count == 1 ? "1 match" : count > 0 ? "\(count) matches" : "Found"
                    self.status.textColor = .secondaryLabelColor
                } else {
                    self.status.stringValue = "Not found"
                    self.status.textColor = .systemRed
                }
                completion?(result.matchFound, count)
            }
        }
    }

    func setQuery(_ text: String) { field.stringValue = text }

    /// Case-insensitive count of visible-text matches, capped at 1,000.
    static func countMatches(of text: String, in webView: WKWebView) async throws -> Int {
        let script = """
        const body = document.body ? document.body.innerText : '';
        const haystack = body.toLocaleLowerCase(), needle = query.toLocaleLowerCase();
        if (!needle) return 0;
        let count = 0, index = haystack.indexOf(needle);
        while (index !== -1 && count < 1000) { count++; index = haystack.indexOf(needle, index + needle.length); }
        return count;
        """
        return (try await webView.runJavaScript(script, arguments: ["query": text], in: world) as? NSNumber)?.intValue ?? 0
    }
}
