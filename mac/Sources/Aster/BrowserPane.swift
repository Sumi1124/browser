// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
import AppKit
import WebKit

/// One web page view plus the browser behaviour around it: navigation
/// policy, pop-ups, JavaScript dialogs, file uploads, downloads and error
/// pages. Used by browser tabs and by both sides of Split Search.
@MainActor
final class BrowserPane: NSObject, WKNavigationDelegate, WKUIDelegate {
    let webView: WKWebView
    let context: BrowsingContext

    /// Called whenever title, URL, loading state or history changes.
    var onChange: (() -> Void)?
    /// Opens a URL in a new tab next to this one.
    var openInNewTab: ((URL) -> Void)?
    /// Creates a tab for a page-requested window (target=_blank, window.open).
    var createTab: ((WKWebViewConfiguration) -> WKWebView?)?
    /// The page asked to close its window (window.close()).
    var onCloseRequest: (() -> Void)?

    private var observations: [NSKeyValueObservation] = []
    /// Counts navigation-policy decisions; the self-test uses it to prove the
    /// delegate method's signature matches WebKit's and is really called.
    static var navigationDecisions = 0

    init(context: BrowsingContext, configuration: WKWebViewConfiguration? = nil) {
        self.context = context
        webView = WebViewFactory.makeWebView(configuration: configuration ?? WebViewFactory.browsingConfiguration(for: context))
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        let notify: (WKWebView) -> Void = { [weak self] _ in
            DispatchQueue.main.async { self?.onChange?() }
        }
        observations = [
            webView.observe(\.title) { view, _ in notify(view) },
            webView.observe(\.url) { view, _ in notify(view) },
            webView.observe(\.isLoading) { view, _ in notify(view) },
            webView.observe(\.canGoBack) { view, _ in notify(view) },
            webView.observe(\.canGoForward) { view, _ in notify(view) },
            webView.observe(\.estimatedProgress) { view, _ in notify(view) },
        ]
    }

    func load(_ url: URL) {
        webView.load(URLRequest(url: url))
    }

    // MARK: Navigation policy

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        Self.navigationDecisions += 1
        guard let url = action.request.url, let scheme = url.scheme?.lowercased() else {
            decisionHandler(.cancel)
            return
        }
        if action.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        let webSchemes: Set<String> = ["http", "https", "about", "blob", "data"]
        if !webSchemes.contains(scheme) {
            // mailto:, tel:, zoommtg: … are handed to the Mac only when the
            // user clicked a link, never when a page redirects on its own.
            decisionHandler(.cancel)
            if action.navigationType == .linkActivated, ["mailto", "tel", "facetime", "maps", "zoommtg", "msteams"].contains(scheme) {
                NSWorkspace.shared.open(url)
            }
            return
        }
        // ⌘-click or a middle-click opens a link in a new tab.
        if action.navigationType == .linkActivated, action.modifierFlags.contains(.command) || action.buttonNumber == 2 {
            decisionHandler(.cancel)
            openInNewTab?(url)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping @MainActor @Sendable (WKNavigationResponsePolicy) -> Void) {
        if !response.canShowMIMEType {
            decisionHandler(.download)
            return
        }
        if let http = response.response as? HTTPURLResponse,
           let disposition = http.value(forHTTPHeaderField: "Content-Disposition"), disposition.lowercased().hasPrefix("attachment"),
           response.isForMainFrame {
            decisionHandler(.download)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        DownloadManager.shared.track(download)
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        DownloadManager.shared.track(download)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showError(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showError(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    private func showError(_ error: Error) {
        let nsError = error as NSError
        // Cancelled loads and downloads that replaced a navigation are not errors.
        if nsError.code == NSURLErrorCancelled || (nsError.domain == "WebKitErrorDomain" && nsError.code == 102) { return }
        let failing = (nsError.userInfo[NSURLErrorFailingURLErrorKey] as? URL)
        let escape = { (text: String) in
            text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
                .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
        }
        let html = """
        <!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
        <title>Can't open this page</title>
        <style>body{font:15px -apple-system,sans-serif;max-width:560px;margin:15vh auto;padding:0 24px;color:CanvasText;background:Canvas}h1{font-size:22px}p{opacity:.75;overflow-wrap:anywhere}</style>
        <h1>Aster can't open this page</h1>
        <p>\(escape(nsError.localizedDescription))</p>
        <p>\(escape(failing?.absoluteString ?? ""))</p>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    // MARK: Windows, dialogs and uploads

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        // WebKit has already blocked pop-ups that were not started by a click.
        createTab?(configuration)
    }

    func webViewDidClose(_ webView: WKWebView) {
        onCloseRequest?()
    }

    private func sheetWindow() -> NSWindow? { webView.window ?? NSApp.keyWindow }

    private func originText(_ frame: WKFrameInfo) -> String {
        let origin = frame.securityOrigin
        return origin.host.isEmpty ? "This page" : "\(origin.host) says"
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor @Sendable () -> Void) {
        let alert = NSAlert()
        alert.messageText = originText(frame)
        alert.informativeText = String(message.prefix(2000))
        alert.addButton(withTitle: "OK")
        present(alert) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor @Sendable (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = originText(frame)
        alert.informativeText = String(message.prefix(2000))
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        present(alert) { response in completionHandler(response == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = originText(frame)
        alert.informativeText = String(prompt.prefix(2000))
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        present(alert) { response in completionHandler(response == .alertFirstButtonReturn ? field.stringValue : nil) }
    }

    private func present(_ alert: NSAlert, completion: @escaping (NSApplication.ModalResponse) -> Void) {
        if let window = sheetWindow() {
            alert.beginSheetModal(for: window, completionHandler: completion)
        } else {
            completion(alert.runModal())
        }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        if let window = sheetWindow() {
            panel.beginSheetModal(for: window) { response in completionHandler(response == .OK ? panel.urls : nil) }
        } else {
            completionHandler(panel.runModal() == .OK ? panel.urls : nil)
        }
    }
}
