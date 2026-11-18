// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
import AppKit
import AsterKit
import WebKit

/// Keeps the ad and tracker blocking rules compiled and attached to every
/// browsing tab. WebKit compiles the rules once and caches them on disk, so
/// later launches reuse the compiled list and start with blocking already on.
@MainActor
final class ContentBlockerManager {
    static let shared = ContentBlockerManager()

    private static let enabledKey = "blockAdsAndTrackers"
    private static let sitesKey = "blockerPausedSites"

    /// Content controllers of every browsing tab, so a change reaches open tabs.
    private let controllers = NSHashTable<WKUserContentController>.weakObjects()
    private var ruleList: WKContentRuleList?
    private var generation = 0

    var isEnabled: Bool {
        get { UserDefaults.standard.object(forKey: Self.enabledKey) as? Bool ?? true }
        set {
            UserDefaults.standard.set(newValue, forKey: Self.enabledKey)
            Task { await refresh() }
        }
    }

    var pausedSites: [String] {
        get { UserDefaults.standard.stringArray(forKey: Self.sitesKey) ?? [] }
        set { UserDefaults.standard.set(Array(Set(newValue.compactMap(ContentBlocker.normalizedSite))).sorted(), forKey: Self.sitesKey) }
    }

    /// True when blocking is paused for this page's site (or its parent site).
    func isPaused(for url: URL?) -> Bool {
        guard let site = Self.site(of: url) else { return false }
        return pausedSites.contains { site == $0 || site.hasSuffix("." + $0) }
    }

    static func site(of url: URL?) -> String? {
        guard let url, ["http", "https"].contains(url.scheme?.lowercased() ?? ""), let host = url.host else { return nil }
        return ContentBlocker.normalizedSite(host)
    }

    /// Pauses or resumes blocking for one site, and reloads it to take effect.
    func setPaused(_ paused: Bool, for url: URL?) async {
        guard let site = Self.site(of: url) else { return }
        var sites = pausedSites.filter { $0 != site && !site.hasSuffix("." + $0) }
        if paused { sites.append(site) }
        pausedSites = sites
        await refresh()
    }

    /// Adds blocking to a new tab's configuration.
    func attach(to controller: WKUserContentController) {
        controllers.add(controller)
        if isEnabled, let ruleList { controller.add(ruleList) }
    }

    /// Compiles (or loads from WebKit's cache) the current rules and applies them
    /// to every open tab. Call before opening the first window so it starts blocked.
    func refresh() async {
        generation += 1
        let mine = generation
        let old = ruleList
        var compiled: WKContentRuleList?
        if isEnabled {
            compiled = await Self.compile(allowedSites: pausedSites)
        }
        guard mine == generation else { return } // a newer change superseded this one
        ruleList = compiled
        for controller in controllers.allObjects {
            if let old { controller.remove(old) }
            if let compiled { controller.add(compiled) }
        }
    }

    /// Compiles `json` under a name made from its contents, reusing the cached
    /// result when the same rules were compiled before.
    static func compile(json: String? = nil, allowedSites: [String] = []) async -> WKContentRuleList? {
        let text = json ?? ContentBlocker.rulesJSON(allowedSites: allowedSites)
        let name = ContentBlocker.identifier(for: text)
        let optionalStore: WKContentRuleListStore? = WKContentRuleListStore.default()
        guard let store = optionalStore else { return nil }
        if let cached = try? await store.contentRuleList(forIdentifier: name) { return cached }
        let list = try? await store.compileContentRuleList(forIdentifier: name, encodedContentRuleList: text)
        // Forget lists compiled by earlier versions or earlier pause settings.
        if json == nil, let identifiers = await store.getAvailableContentRuleListIdentifiers() {
            for old in identifiers where old.hasPrefix("aster-blocker-") && old != name {
                try? await store.removeContentRuleList(forIdentifier: old)
            }
        }
        return list
    }
}
