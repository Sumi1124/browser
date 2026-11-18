// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
import Foundation

/// Builds the ad and tracker blocking rules that WebKit compiles into native
/// code (a WKContentRuleList). Blocking happens inside WebKit before a request
/// is sent, so it needs no JavaScript in pages and adds almost no delay, and
/// blocked ads and trackers never download, which makes pages load faster.
///
/// Rules only affect third-party requests (a page asking another company's
/// server for something), so a site's own images, scripts and logins keep
/// working, and visiting an ad network's own website is never blocked.
public enum ContentBlocker {
    /// Change this when the lists change so Aster recompiles its cached rules.
    public static let listVersion = 1

    /// Advertising networks, exchanges and ad-serving hosts.
    public static let adDomains: [String] = [
        "doubleclick.net", "googlesyndication.com", "googleadservices.com", "adservice.google.com",
        "pagead2.googlesyndication.com", "tpc.googlesyndication.com", "2mdn.net", "admob.com",
        "adnxs.com", "adsrvr.org", "adform.net", "advertising.com", "adtechus.com",
        "amazon-adsystem.com", "bidswitch.net", "casalemedia.com", "contextweb.com", "criteo.com",
        "criteo.net", "demdex.net", "districtm.io", "emxdgt.com", "gumgum.com", "indexww.com",
        "lijit.com", "media.net", "mathtag.com", "moatads.com", "openx.net", "outbrain.com",
        "pubmatic.com", "revcontent.com", "rubiconproject.com", "serving-sys.com", "sharethrough.com",
        "smartadserver.com", "sovrn.com", "spotx.tv", "taboola.com", "teads.tv",
        "tremorhub.com", "triplelift.com", "turn.com", "undertone.com", "yieldmo.com", "zedo.com",
        "adsafeprotected.com", "doubleverify.com", "innovid.com", "adcolony.com", "applovin.com",
        "unityads.unity3d.com", "ads.yahoo.com", "advertising.yahoo.com", 
        "ads.twitter.com", "static.ads-twitter.com", "ads.linkedin.com", "ads.tiktok.com",
        "an.facebook.com", "ads.reddit.com", "ads.pinterest.com", "ads.youtube.com",
        "adroll.com", "perfectaudience.com", "rlcdn.com", "bluekai.com", "exelator.com",
        "eyeota.net", "everesttech.net", "krxd.net", "agkn.com", "tapad.com", "3lift.com",
        "33across.com", "bidr.io", "adscale.de", "yandexadexchange.net", "mgid.com", "popads.net",
        "propellerads.com", "popcash.net", "exoclick.com", "juicyads.com", "trafficjunky.net",
        "adsterra.com", "clickadu.com", "hilltopads.net", "zemanta.com", 
    ]

    /// Analytics, session recording and tracking pixels.
    public static let trackerDomains: [String] = [
        "google-analytics.com", "analytics.google.com", "stats.g.doubleclick.net", "app-measurement.com",
        "scorecardresearch.com", "quantserve.com", "quantcount.com", "chartbeat.com", "chartbeat.net",
        "hotjar.com", "hotjar.io", "fullstory.com", "mouseflow.com", "crazyegg.com", "luckyorange.com",
        "inspectlet.com", "smartlook.com", "clarity.ms", "mixpanel.com", "heapanalytics.com",
        "amplitude.com", "segment.io", "kissmetrics.com", 
        "bat.bing.com", "analytics.yahoo.com", "analytics.twitter.com",
        "analytics.tiktok.com", "px.ads.linkedin.com", "snap.licdn.com", "sc-static.net",
        "tr.snapchat.com", "pixel.facebook.com", "pixel.wp.com", "stats.wp.com", "bugsnag.com",
        "parsely.com", "pingdom.net", "adjust.com", "appsflyer.com", "kochava.com",
        "singular.net", "hs-analytics.net", "hsadspixel.net", "marketo.net",
        "pardot.com", "omtrdc.net", "2o7.net", "demandbase.com", "6sc.co", 
        "tiqcdn.com", "ensighten.com", "bounceexchange.com", "bouncex.net",
        "crwdcntrl.net", "addthis.com", "sharethis.com", "disqusads.com", 
    ]

    /// A few well-known tracking scripts that live on hosts the page may need
    /// for other things, matched by file name instead of by whole host.
    /// These use the regular-expression subset WebKit supports.
    public static let scriptPatterns: [String] = [
        "^[^:]+://+connect\\.facebook\\.net/[^/]+/fbevents\\.js",
        "^[^:]+://+www\\.googletagmanager\\.com/gtag/js",
        "^[^:]+://+www\\.google\\.com/pagead/",
        "^[^:]+://+www\\.youtube\\.com/pagead/",
        "^[^:]+://+www\\.youtube\\.com/api/stats/ads",
        "^[^:]+://+www\\.google\\.com/ads/",
    ]

    /// Empty boxes left behind where ads would have been.
    public static let hiddenSelectors: [String] = [
        "ins.adsbygoogle", ".adsbygoogle", ".google-auto-placed",
        "[id^=\"google_ads_iframe\"]", "[id^=\"div-gpt-ad\"]", "[id^=\"google_ads_\"]",
        "iframe[src*=\"doubleclick.net\"]", "iframe[src*=\"googlesyndication.com\"]",
        "iframe[src*=\"amazon-adsystem.com\"]", "[data-ad-slot]", "[data-google-query-id]",
        ".taboola-container", "[id^=\"taboola-\"]", "[id^=\"outbrain\"]", ".OUTBRAIN",
    ]

    /// Turns what someone typed or a page's host into the site name used for
    /// "pause blocking on this site": lowercase, no `www.`, letters, digits,
    /// dots and hyphens only. Returns nil for anything else.
    public static func normalizedSite(_ text: String) -> String? {
        var site = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if site.hasPrefix("www.") { site.removeFirst(4) }
        guard (1...253).contains(site.count), site.contains("."),
              site.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "." || $0 == "-") }),
              !site.hasPrefix("."), !site.hasSuffix("."), !site.hasPrefix("-"), !site.contains("..")
        else { return nil }
        return site
    }

    /// The regular expression that matches any URL on `domain` or its subdomains.
    static func hostPattern(_ domain: String) -> String {
        "^[^:]+://+([^:/]+\\.)?" + domain.replacingOccurrences(of: ".", with: "\\.") + "[:/]"
    }

    /// The rules as the JSON text WebKit compiles.
    ///
    /// - Parameters:
    ///   - domains: hosts to block when a page loads something from them.
    ///   - patterns: extra URL patterns to block.
    ///   - hide: CSS selectors of ad containers to hide.
    ///   - allowedSites: sites where blocking is paused. These come last so
    ///     they cancel every earlier rule on those sites and their subdomains.
    public static func rulesJSON(blocking domains: [String] = adDomains + trackerDomains,
                                 patterns: [String] = scriptPatterns,
                                 hide: [String] = hiddenSelectors,
                                 allowedSites: [String] = []) -> String {
        var rules: [[String: Any]] = []
        for domain in Set(domains).sorted() {
            rules.append(["trigger": ["url-filter": hostPattern(domain), "load-type": ["third-party"]],
                          "action": ["type": "block"]])
        }
        for pattern in patterns {
            rules.append(["trigger": ["url-filter": pattern, "load-type": ["third-party"]],
                          "action": ["type": "block"]])
        }
        if !hide.isEmpty {
            rules.append(["trigger": ["url-filter": ".*"],
                          "action": ["type": "css-display-none", "selector": hide.joined(separator: ", ")]])
        }
        let sites = Set(allowedSites.compactMap(normalizedSite)).sorted()
        if !sites.isEmpty {
            rules.append(["trigger": ["url-filter": ".*", "if-domain": sites.map { "*" + $0 }],
                          "action": ["type": "ignore-previous-rules"]])
        }
        let data = (try? JSONSerialization.data(withJSONObject: rules, options: [.sortedKeys])) ?? Data("[]".utf8)
        return String(decoding: data, as: UTF8.self)
    }

    /// A short name for a compiled list that changes whenever its rules do, so
    /// an unchanged list is reused from WebKit's cache instead of recompiled.
    public static func identifier(for json: String) -> String {
        var hash: UInt64 = 0xcbf29ce484222325 // FNV-1a
        for byte in json.utf8 { hash = (hash ^ UInt64(byte)) &* 0x100000001b3 }
        return "aster-blocker-\(listVersion)-" + String(hash, radix: 16)
    }
}
