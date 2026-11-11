// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
import AppKit
import AsterKit
import UniformTypeIdentifiers
import WebKit

/// Serves the bundled study-tools page and modules at aster://app/.
/// Only files inside Contents/Resources/web are reachable.
@MainActor
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "aster"
    let root: URL

    init(root: URL) {
        self.root = root.standardizedFileURL.resolvingSymlinksInPath()
    }

    private static let types = ["html": "text/html", "js": "text/javascript", "mjs": "text/javascript", "css": "text/css",
                                "json": "application/json", "svg": "image/svg+xml", "png": "image/png"]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.scheme == Self.scheme, url.host == "app" else {
            task.didFailWithError(URLError(.unsupportedURL))
            return
        }
        let path = url.path.isEmpty || url.path == "/" ? "tools.html" : String(url.path.dropFirst())
        let file = root.appendingPathComponent(path).standardizedFileURL.resolvingSymlinksInPath()
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let type = Self.types[file.pathExtension.lowercased()] ?? "application/octet-stream"
        let headers = ["Content-Type": type, "Content-Length": String(data.count), "Cache-Control": "no-store",
                       "X-Content-Type-Options": "nosniff"]
        guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) else {
            task.didFailWithError(URLError(.cannotParseResponse))
            return
        }
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// What a tools panel needs from the browser window that hosts it.
@MainActor
protocol ToolsPanelOwner: AnyObject {
    var hostWindow: NSWindow? { get }
    func extractCitation() async throws -> [String: Any]
    func openInNewTab(_ url: URL)
}

struct ToolsError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Shared storage for every tools panel, so two windows never overwrite
/// each other's changes with stale data.
@MainActor
final class ToolsHub {
    static let shared = ToolsHub()
    var store: ToolsStore
    private var panels: [WeakPanel] = []

    private struct WeakPanel { weak var panel: ToolsPanel? }

    private init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support")
        store = ToolsStore(directory: support.appendingPathComponent("Aster/Study Tools", isDirectory: true))
    }

    func register(_ panel: ToolsPanel) {
        panels.removeAll { $0.panel == nil }
        panels.append(WeakPanel(panel: panel))
    }

    /// Tells every other open panel to reload a module after it changed.
    func didSave(_ key: String, from source: ToolsPanel) {
        for case let panel? in panels.map(\.panel) where panel !== source {
            panel.webView.callAsyncJavaScript("if (window.asterTools) await window.asterTools.reload(key);",
                                              arguments: ["key": key], in: nil, in: .page, completionHandler: nil)
        }
    }

    static var webRoot: URL {
        Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true)
    }
}

/// The study-tools sidebar: a WKWebView showing the bundled tools page,
/// with a narrow message bridge for storage and file dialogs.
@MainActor
final class ToolsPanel: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
    let webView: WKWebView
    weak var owner: ToolsPanelOwner?
    private static let schemeHandler = AppSchemeHandler(root: ToolsHub.webRoot)
    private static let maxOpenBytes = 32 * 1024 * 1024

    init(owner: ToolsPanelOwner?) {
        self.owner = owner
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(Self.schemeHandler, forURLScheme: AppSchemeHandler.scheme)
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isInspectable = true
        super.init()
        // The bridge exists only in the tools page's own JavaScript world. A weak
        // forwarder avoids WebKit keeping this panel (and its window) alive.
        webView.configuration.userContentController.addScriptMessageHandler(WeakReplyHandler(self), contentWorld: .page, name: "aster")
        webView.navigationDelegate = self
        ToolsHub.shared.register(self)
    }

    func load() {
        webView.load(URLRequest(url: URL(string: "aster://app/tools.html")!))
    }

    func show(view: String) {
        webView.callAsyncJavaScript("window.asterTools?.selectView(view);", arguments: ["view": view], in: nil, in: .page, completionHandler: nil)
    }

    func receiveCitation(_ metadata: [String: Any]) {
        webView.callAsyncJavaScript("window.asterTools?.receiveCitation(metadata);", arguments: ["metadata": metadata], in: nil, in: .page, completionHandler: nil)
    }

    // The tools page never navigates anywhere else.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        let scheme = action.request.url?.scheme?.lowercased()
        decisionHandler(scheme == AppSchemeHandler.scheme || scheme == "blob" ? .allow : .cancel)
    }

    // MARK: Bridge

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == AppSchemeHandler.scheme,
              let body = message.body as? [String: Any], let op = body["op"] as? String else {
            replyHandler(nil, "Request refused.")
            return
        }
        Task { @MainActor in
            do {
                replyHandler(try await self.handle(op, body), nil)
            } catch {
                replyHandler(nil, error.localizedDescription)
            }
        }
    }

    private func string(_ body: [String: Any], _ key: String) throws -> String {
        guard let value = body[key] as? String else { throw ToolsError(message: "Missing \(key).") }
        return value
    }

    private func handle(_ op: String, _ body: [String: Any]) async throws -> Any {
        switch op {
        case "appInfo":
            return ["version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"]
        case "load":
            return try ToolsHub.shared.store.load(try string(body, "key")) ?? NSNull()
        case "save":
            let key = try string(body, "key")
            try ToolsHub.shared.store.save(key, text: try string(body, "text"))
            ToolsHub.shared.didSave(key, from: self)
            return true
        case "saveFile":
            return try await saveFile(name: try string(body, "suggestedName"), text: try string(body, "text"))
        case "openFile":
            return try await openFile(types: body["types"] as? [String] ?? [])
        case "citeCurrentPage":
            guard let owner else { throw ToolsError(message: "Open a web page first, then cite it.") }
            return try await owner.extractCitation()
        case "openURL":
            guard let url = URL(string: try string(body, "url")), ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
                throw ToolsError(message: "Only web links can be opened.")
            }
            owner?.openInNewTab(url)
            return true
        default:
            throw ToolsError(message: "Unknown request.")
        }
    }

    private func saveFile(name: String, text: String) async throws -> Bool {
        let panel = NSSavePanel()
        let fileName = FileNames.sanitize(name, fallback: "export.txt")
        panel.nameFieldStringValue = fileName
        panel.canCreateDirectories = true
        if let type = UTType(filenameExtension: (fileName as NSString).pathExtension) { panel.allowedContentTypes = [type] }
        guard await run(panel) == .OK, let url = panel.url else { return false }
        try Data(text.utf8).write(to: url, options: .atomic)
        return true
    }

    private func openFile(types: [String]) async throws -> Any {
        let allowed = Set(["csv", "tsv", "txt", "json"])
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = types.filter(allowed.contains).compactMap { UTType(filenameExtension: $0) }
        guard await run(panel) == .OK, let url = panel.url else { return NSNull() }
        let size = (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size <= Self.maxOpenBytes else { throw ToolsError(message: "That file is too large (limit 32 MB).") }
        let data = try Data(contentsOf: url)
        let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) ?? ""
        return ["name": url.lastPathComponent, "text": text]
    }

    private func run(_ panel: NSSavePanel) async -> NSApplication.ModalResponse {
        if let window = owner?.hostWindow ?? webView.window {
            return await withCheckedContinuation { continuation in
                panel.beginSheetModal(for: window) { continuation.resume(returning: $0) }
            }
        }
        return panel.runModal()
    }
}

/// Forwards bridge messages without WebKit retaining the panel.
@MainActor
private final class WeakReplyHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var target: ToolsPanel?
    init(_ target: ToolsPanel) { self.target = target }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard let target else { replyHandler(nil, "The tools panel was closed."); return }
        target.userContentController(controller, didReceive: message, replyHandler: replyHandler)
    }
}

@MainActor
extension WKWebView {
    /// callAsyncJavaScript as an async function.
    func runJavaScript(_ body: String, arguments: [String: Any] = [:], in world: WKContentWorld = .page) async throws -> Any? {
        try await withCheckedThrowingContinuation { continuation in
            callAsyncJavaScript(body, arguments: arguments, in: nil, in: world) { result in
                switch result {
                case .success(let value): continuation.resume(returning: value)
                case .failure(let error): continuation.resume(throwing: error)
                }
            }
        }
    }
}

/// Runs the tested citation extractor (aster/research/metadata.mjs) in an
/// isolated JavaScript world of the current page.
@MainActor
enum CitationRunner {
    static let world = WKContentWorld.world(name: "AsterCitations")

    static let script: String? = {
        let url = ToolsHub.webRoot.appendingPathComponent("aster/research/metadata.mjs")
        guard let source = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return CitationScript.functionBody(fromModule: source)
    }()

    static func extract(from webView: WKWebView) async throws -> [String: Any] {
        guard let scheme = webView.url?.scheme?.lowercased(), ["http", "https"].contains(scheme) else {
            throw ToolsError(message: "Open a web page first, then cite it.")
        }
        guard let script else { throw ToolsError(message: "The citation tool is missing from this copy of Aster.") }
        guard let metadata = try await webView.runJavaScript(script, in: world) as? [String: Any] else {
            throw ToolsError(message: "This page's details could not be read.")
        }
        return metadata
    }
}
