// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
import AppKit
import AsterKit
import WebKit

/// Where a window's cookies, logins and site data live. Each workspace has
/// its own persistent WebKit data store, so being signed in to a site in
/// "Business" does not sign you in under "Personal". Private windows use a
/// memory-only store that is discarded when they close.
@MainActor
final class BrowsingContext {
    let id: String
    let name: String
    let isPrivate: Bool
    let dataStore: WKWebsiteDataStore
    let tabbingIdentifier: String

    private init(id: String, name: String, isPrivate: Bool, dataStore: WKWebsiteDataStore) {
        self.id = id
        self.name = name
        self.isPrivate = isPrivate
        self.dataStore = dataStore
        tabbingIdentifier = "aster.\(id)"
    }

    private static var workspaces: [String: BrowsingContext] = [:]
    private static let storeIdsKey = "workspaceDataStoreIDs"

    static func workspace(_ workspace: Workspace) -> BrowsingContext {
        if let existing = workspaces[workspace.id] { return existing }
        var ids = UserDefaults.standard.dictionary(forKey: storeIdsKey) as? [String: String] ?? [:]
        let uuid = ids[workspace.id].flatMap(UUID.init(uuidString:)) ?? UUID()
        ids[workspace.id] = uuid.uuidString
        UserDefaults.standard.set(ids, forKey: storeIdsKey)
        // Separate per-workspace stores need macOS 14. On macOS 13 every
        // workspace shares the default store (logins are shared).
        let store: WKWebsiteDataStore
        if #available(macOS 14, *) { store = WKWebsiteDataStore(forIdentifier: uuid) } else { store = .default() }
        let context = BrowsingContext(id: workspace.id, name: workspace.name, isPrivate: false, dataStore: store)
        workspaces[workspace.id] = context
        return context
    }

    static func makePrivate() -> BrowsingContext {
        BrowsingContext(id: "private-\(UUID().uuidString)", name: "Private", isPrivate: true, dataStore: .nonPersistent())
    }

    /// Removes cookies, cache and site data for one workspace.
    func clearWebsiteData() async {
        await dataStore.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
    }
}

/// Serves the Start page at aster-start://home/. Because it has a real
/// address, Back returns to it and Reload refreshes it (a page loaded from a
/// string comes back blank). It is only served as the top-level page, never
/// inside a frame on a website.
@MainActor
final class StartPageSchemeHandler: NSObject, WKURLSchemeHandler {
    let workspaceName: String
    let isPrivate: Bool

    init(workspaceName: String, isPrivate: Bool) {
        self.workspaceName = workspaceName
        self.isPrivate = isPrivate
    }

    static func html(workspaceName: String, isPrivate: Bool) -> String {
        let store = ToolsHub.shared.store
        let bookmarks = (try? BookmarkFile(store: store).read().bookmarks) ?? []
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        let glance = StartPage.Glance.parse(try? store.load("glance"), today: formatter.string(from: Date()))
        return StartPage.html(workspace: workspaceName, isPrivate: isPrivate, provider: AppDelegate.shared.searchProvider,
                              bookmarks: bookmarks.reversed(), glance: glance,
                              version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String)
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, StartPage.isStartPage(url),
              task.request.mainDocumentURL == nil || task.request.mainDocumentURL == url else {
            task.didFailWithError(URLError(.unsupportedURL))
            return
        }
        let data = Data(Self.html(workspaceName: workspaceName, isPrivate: isPrivate).utf8)
        let headers = ["Content-Type": "text/html; charset=utf-8", "Content-Length": String(data.count), "Cache-Control": "no-store",
                       "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "frame-ancestors 'none'"]
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

enum WebViewFactory {
    /// Configuration for ordinary browsing tabs. Browsing tabs never get the
    /// study-tools bridge; only the bundled tools page does.
    @MainActor
    static func browsingConfiguration(for context: BrowsingContext) -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = context.dataStore
        configuration.setURLSchemeHandler(StartPageSchemeHandler(workspaceName: context.name, isPrivate: context.isPrivate),
                                          forURLScheme: StartPage.scheme)
        configuration.preferences.isFraudulentWebsiteWarningEnabled = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.defaultWebpagePreferences.preferredContentMode = .desktop
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        // Many sites check for "Safari" to decide which features to serve.
        configuration.applicationNameForUserAgent = "Version/18.0 Safari/605.1.15"
        configuration.allowsAirPlayForMediaPlayback = true
        // Lets video players (YouTube, Vimeo…) use their full-screen button.
        configuration.preferences.isElementFullscreenEnabled = true
        return configuration
    }

    @MainActor
    static func makeWebView(configuration: WKWebViewConfiguration) -> WKWebView {
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsMagnification = true
        if #available(macOS 13.3, *) { webView.isInspectable = true }
        return webView
    }
}
