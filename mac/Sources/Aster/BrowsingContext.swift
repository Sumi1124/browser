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
        let context = BrowsingContext(id: workspace.id, name: workspace.name, isPrivate: false,
                                      dataStore: WKWebsiteDataStore(forIdentifier: uuid))
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

enum WebViewFactory {
    /// Configuration for ordinary browsing tabs. Browsing tabs never get the
    /// study-tools bridge; only the bundled tools page does.
    @MainActor
    static func browsingConfiguration(for context: BrowsingContext) -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = context.dataStore
        configuration.preferences.isFraudulentWebsiteWarningEnabled = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.defaultWebpagePreferences.preferredContentMode = .desktop
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        // Many sites check for "Safari" to decide which features to serve.
        configuration.applicationNameForUserAgent = "Version/18.0 Safari/605.1.15"
        configuration.allowsAirPlayForMediaPlayback = true
        return configuration
    }

    @MainActor
    static func makeWebView(configuration: WKWebViewConfiguration) -> WKWebView {
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsMagnification = true
        webView.isInspectable = true
        return webView
    }
}
