// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
// UI-free logic shared by the Aster Mac app: address-bar parsing, search
// providers, workspaces, local storage and the citation script.
import Foundation

// MARK: - Search providers

public struct SearchProvider: Equatable, Sendable {
    public let id: String
    public let name: String
    /// HTTPS template with exactly one `{query}` placeholder.
    public let template: String

    /// Same providers as the C++ core (aster/core/search.cc).
    public static let all: [SearchProvider] = [
        SearchProvider(id: "google", name: "Google", template: "https://www.google.com/search?q={query}"),
        SearchProvider(id: "duckduckgo", name: "DuckDuckGo", template: "https://duckduckgo.com/?q={query}"),
        SearchProvider(id: "bing", name: "Bing", template: "https://www.bing.com/search?q={query}"),
        SearchProvider(id: "brave", name: "Brave Search", template: "https://search.brave.com/search?q={query}"),
        SearchProvider(id: "yahoo", name: "Yahoo", template: "https://search.yahoo.com/search?p={query}"),
        SearchProvider(id: "ecosia", name: "Ecosia", template: "https://www.ecosia.org/search?q={query}"),
    ]
    public static let fallback = all[0]

    public static func provider(id: String?) -> SearchProvider {
        all.first { $0.id == id } ?? fallback
    }

    /// Percent-encodes everything except RFC 3986 unreserved characters, so
    /// `&`, `#`, `+` and `=` in a query can never change the URL structure.
    public func url(for query: String) -> URL? {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.utf8.count <= 2048 else { return nil }
        var allowed = CharacterSet()
        allowed.insert(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        guard let encoded = trimmed.addingPercentEncoding(withAllowedCharacters: allowed) else { return nil }
        return URL(string: template.replacingOccurrences(of: "{query}", with: encoded))
    }
}

// MARK: - Address bar

public enum AddressInput {
    /// Schemes a user may type into the address bar. Everything else
    /// (javascript:, file:, data: …) is treated as a search instead.
    static let navigableSchemes: Set<String> = ["http", "https"]

    /// Turns address-bar text into a URL to load: a web address when the
    /// text looks like one, otherwise a search with `provider`.
    public static func resolve(_ text: String, provider: SearchProvider) -> URL? {
        let input = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.isEmpty else { return nil }
        if input.lowercased() == "about:blank" { return URL(string: "about:blank") }
        if input.rangeOfCharacter(from: .whitespacesAndNewlines) == nil {
            if let url = URL(string: input), let scheme = url.scheme?.lowercased() {
                if navigableSchemes.contains(scheme), let host = url.host, !host.isEmpty { return url }
                if !looksLikeHostWithPort(input) { return provider.url(for: input) }
            }
            if looksLikeHost(input), let url = URL(string: (isLocal(input) ? "http://" : "https://") + input), url.host != nil {
                return url
            }
        }
        return provider.url(for: input)
    }

    private static func hostPart(_ input: String) -> String {
        let end = input.firstIndex { "/?#".contains($0) } ?? input.endIndex
        return String(input[..<end])
    }

    private static func looksLikeHostWithPort(_ input: String) -> Bool {
        let host = hostPart(input)
        guard let colon = host.lastIndex(of: ":") else { return false }
        let port = host[host.index(after: colon)...]
        return !port.isEmpty && port.allSatisfy(\.isNumber) && looksLikeHost(String(host[..<colon]))
    }

    static func looksLikeHost(_ input: String) -> Bool {
        var host = hostPart(input).lowercased()
        if let colon = host.lastIndex(of: ":"), host[host.index(after: colon)...].allSatisfy(\.isNumber) {
            host = String(host[..<colon])
        }
        if host == "localhost" { return true }
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.count >= 2, labels.allSatisfy({ !$0.isEmpty && $0.count <= 63 }) else { return false }
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-"))
        guard labels.allSatisfy({ $0.unicodeScalars.allSatisfy(allowed.contains) && !$0.hasPrefix("-") && !$0.hasSuffix("-") }) else { return false }
        if labels.allSatisfy({ $0.allSatisfy(\.isNumber) }) { return labels.count == 4 } // IPv4
        // The last label must be a plausible top-level domain, so "file.txt"-like
        // words with digits-only or one-letter endings are searched instead.
        guard let tld = labels.last, tld.count >= 2, !tld.allSatisfy(\.isNumber) else { return false }
        return true
    }

    private static func isLocal(_ input: String) -> Bool {
        let host = hostPart(input).lowercased()
        return host == "localhost" || host.hasPrefix("localhost:") || host.hasPrefix("127.") || host.hasPrefix("192.168.") || host.hasPrefix("10.")
    }

    /// Text to show in the address bar for a loaded URL.
    public static func display(_ url: URL?) -> String {
        guard let url, url.absoluteString != "about:blank" else { return "" }
        return url.absoluteString
    }
}

// MARK: - Workspaces

public struct Workspace: Equatable, Sendable {
    public let id: String
    public let name: String

    /// Same defaults as the C++ workspace catalog (aster/core/workspace.cc).
    public static let defaults: [Workspace] = [
        Workspace(id: "personal", name: "Personal"),
        Workspace(id: "business", name: "Business"),
        Workspace(id: "ib-myp", name: "IB MYP"),
        Workspace(id: "ib-dp", name: "IB Diploma Programme"),
        Workspace(id: "research", name: "Research and Data Analysis"),
    ]
}

// MARK: - Local storage for the study tools

public enum StorageError: Error, Equatable, LocalizedError {
    case invalidKey
    case tooLarge

    public var errorDescription: String? {
        switch self {
        case .invalidKey: return "Invalid storage key."
        case .tooLarge: return "The data is too large to save."
        }
    }
}

/// Stores each study-tools module as one JSON text file, written atomically
/// so a crash or power loss leaves either the old or the new file.
public final class ToolsStore {
    public static let maxBytes = 64 * 1024 * 1024
    public let directory: URL

    public init(directory: URL) {
        self.directory = directory
    }

    public static func isValidKey(_ key: String) -> Bool {
        key.range(of: "^[a-z][a-z-]{0,31}$", options: .regularExpression) != nil
    }

    private func file(for key: String) throws -> URL {
        guard Self.isValidKey(key) else { throw StorageError.invalidKey }
        return directory.appendingPathComponent("\(key).json", isDirectory: false)
    }

    public func load(_ key: String) throws -> String? {
        let url = try file(for: key)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let data = try Data(contentsOf: url)
        guard data.count <= Self.maxBytes else { throw StorageError.tooLarge }
        return String(decoding: data, as: UTF8.self)
    }

    public func save(_ key: String, text: String) throws {
        let url = try file(for: key)
        let data = Data(text.utf8)
        guard data.count <= Self.maxBytes else { throw StorageError.tooLarge }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        try data.write(to: url, options: [.atomic])
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}

// MARK: - Citation extraction

public enum CitationScript {
    /// Wraps aster/research/metadata.mjs as a function body for
    /// WKWebView.callAsyncJavaScript in an isolated content world: the page's
    /// own scripts cannot see or alter it, and it reads only the DOM.
    public static func functionBody(fromModule source: String) -> String? {
        guard !source.contains("import ") else { return nil }
        let body = source.replacingOccurrences(of: "export function ", with: "function ")
        guard !body.contains("export ") else { return nil }
        return body + "\nreturn extractPageMetadata(document, location.href);\n"
    }
}

// MARK: - File names

public enum FileNames {
    /// Keeps a suggested download or export name safe to use in a folder:
    /// no path separators, no leading dots, no control characters.
    public static func sanitize(_ name: String, fallback: String = "download") -> String {
        var result = name.components(separatedBy: CharacterSet(charactersIn: "/\\:")).last ?? ""
        result = String(result.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) })
        result = result.trimmingCharacters(in: .whitespacesAndNewlines)
        while result.hasPrefix(".") { result.removeFirst() }
        if result.count > 200 { result = String(result.suffix(200)) }
        return result.isEmpty ? fallback : result
    }

    /// Returns `name` in `directory`, adding " 2", " 3"… before the
    /// extension when a file with that name already exists.
    public static func unique(_ name: String, in directory: URL) -> URL {
        let base = (name as NSString).deletingPathExtension
        let ext = (name as NSString).pathExtension
        var candidate = directory.appendingPathComponent(name)
        var n = 2
        while FileManager.default.fileExists(atPath: candidate.path) {
            candidate = directory.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
            n += 1
        }
        return candidate
    }
}

// MARK: - Bookmarks

public enum BookmarkError: Error, Equatable, LocalizedError {
    case unreadable
    case notWebPage
    case tooMany

    public var errorDescription: String? {
        switch self {
        case .unreadable: return "Your bookmarks file couldn't be read, so it was left untouched. Restore a backup from Study Tools → Backup."
        case .notWebPage: return "Only web pages (http and https) can be bookmarked."
        case .tooMany: return "You have reached the limit of 10,000 bookmarks."
        }
    }
}

/// Native access to the bookmarks file that the study-tools page
/// (aster/research/bookmarks.mjs) also reads and writes. Edits keep every
/// field they don't understand, and an unreadable file is never overwritten.
public final class BookmarkFile {
    public static let storageKey = "bookmarks"
    public static let maxBookmarks = 10_000

    public struct Bookmark: Equatable, Sendable {
        public let id: String
        public let title: String
        public let url: URL
        public let folderId: String?
    }

    public struct Folder: Equatable, Sendable {
        public let id: String
        public let name: String
    }

    public struct Contents: Equatable, Sendable {
        public var folders: [Folder] = []
        public var bookmarks: [Bookmark] = []
    }

    let store: ToolsStore

    public init(store: ToolsStore) {
        self.store = store
    }

    /// Same rule as bookmarkKey() in bookmarks.mjs: http(s) only, no
    /// credentials, and the #fragment and trailing slashes are ignored.
    public static func key(_ url: URL) -> String? {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              url.user == nil, url.password == nil,
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false), let host = components.host, !host.isEmpty else {
            return nil
        }
        components.fragment = nil
        components.scheme = scheme
        components.host = host.lowercased()
        guard var text = components.string else { return nil }
        while text.hasSuffix("/") { text.removeLast() }
        return text
    }

    private func readRaw() throws -> [String: Any] {
        guard let text = try store.load(Self.storageKey) else {
            return ["schema": 1, "folders": [Any](), "bookmarks": [Any]()]
        }
        guard let object = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
              object["schema"] as? Int == 1, object["folders"] is [Any], object["bookmarks"] is [Any] else {
            throw BookmarkError.unreadable
        }
        return object
    }

    private func write(_ object: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.withoutEscapingSlashes])
        try store.save(Self.storageKey, text: String(decoding: data, as: UTF8.self))
    }

    public func read() throws -> Contents {
        let raw = try readRaw()
        var contents = Contents()
        for case let folder as [String: Any] in raw["folders"] as? [Any] ?? [] {
            if let id = folder["id"] as? String, let name = folder["name"] as? String { contents.folders.append(Folder(id: id, name: name)) }
        }
        for case let item as [String: Any] in raw["bookmarks"] as? [Any] ?? [] {
            guard let id = item["id"] as? String, let text = item["url"] as? String, let url = URL(string: text), Self.key(url) != nil else { continue }
            contents.bookmarks.append(Bookmark(id: id, title: item["title"] as? String ?? url.host ?? text, url: url, folderId: item["folderId"] as? String))
        }
        return contents
    }

    public func contains(_ url: URL) -> Bool {
        guard let key = Self.key(url), let contents = try? read() else { return false }
        return contents.bookmarks.contains { Self.key($0.url) == key }
    }

    /// Adds an unfiled bookmark. Returns false if the page is already bookmarked.
    @discardableResult
    public func add(url: URL, title: String, now: Date = Date()) throws -> Bool {
        guard let key = Self.key(url) else { throw BookmarkError.notWebPage }
        var raw = try readRaw()
        var bookmarks = raw["bookmarks"] as? [Any] ?? []
        let exists = bookmarks.contains { item in
            guard let text = (item as? [String: Any])?["url"] as? String, let other = URL(string: text) else { return false }
            return Self.key(other) == key
        }
        if exists { return false }
        guard bookmarks.count < Self.maxBookmarks else { throw BookmarkError.tooMany }
        var cleanTitle = title.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
        cleanTitle = String(cleanTitle.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }.prefix(256))
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        bookmarks.append([
            "id": UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(24).description,
            "url": url.absoluteString,
            "title": cleanTitle.isEmpty ? (url.host ?? url.absoluteString) : cleanTitle,
            "folderId": NSNull(),
            "addedAt": formatter.string(from: now),
        ])
        raw["bookmarks"] = bookmarks
        try write(raw)
        return true
    }

    /// Removes every bookmark for this page. Returns false if there was none.
    @discardableResult
    public func remove(url: URL) throws -> Bool {
        guard let key = Self.key(url) else { return false }
        var raw = try readRaw()
        let before = raw["bookmarks"] as? [Any] ?? []
        let after = before.filter { item in
            guard let text = (item as? [String: Any])?["url"] as? String, let other = URL(string: text) else { return true }
            return Self.key(other) != key
        }
        guard after.count != before.count else { return false }
        raw["bookmarks"] = after
        try write(raw)
        return true
    }
}

// MARK: - Start page

/// The page new tabs open on: a search box for the chosen engine and the
/// user's bookmarks as tiles. Static HTML with no scripts; every bookmark
/// title and address is escaped.
public enum StartPage {
    public static func escape(_ text: String) -> String {
        var result = ""
        result.reserveCapacity(text.count)
        for char in text {
            switch char {
            case "&": result += "&amp;"
            case "<": result += "&lt;"
            case ">": result += "&gt;"
            case "\"": result += "&quot;"
            case "'": result += "&#39;"
            default: result.append(char)
            }
        }
        return result
    }

    /// The form action and field name for a provider's `…?q={query}` template.
    public static func searchForm(for provider: SearchProvider) -> (action: String, field: String)? {
        guard let components = URLComponents(string: provider.template),
              let field = components.queryItems?.first(where: { $0.value == "{query}" })?.name,
              components.scheme == "https", let host = components.host else { return nil }
        return ("https://\(host)\(components.path)", field)
    }

    private static let palette = [("#e3f0e8", "#1f6b3d"), ("#e6eefb", "#23509c"), ("#eeeafc", "#5b45c2"),
                                  ("#fdf0dc", "#8a5200"), ("#fbe9e7", "#a8322a"), ("#f0f0f3", "#3a3a40")]

    static func monogram(for bookmark: BookmarkFile.Bookmark) -> (letter: String, background: String, foreground: String) {
        // The bookmark's own name gives the letter ("Wikipedia" → W), not
        // its address ("en.wikipedia.org" → E); the address picks the colour.
        var host = bookmark.url.host ?? bookmark.title
        if host.hasPrefix("www.") { host.removeFirst(4) }
        var hash: UInt32 = 0
        for scalar in host.unicodeScalars { hash = hash &* 31 &+ scalar.value }
        let colors = palette[Int(hash % UInt32(palette.count))]
        let letter = bookmark.title.first(where: { $0.isLetter || $0.isNumber }) ?? host.first ?? "?"
        return (String(letter).uppercased(), colors.0, colors.1)
    }

    /// Today's tasks and due flashcards, as saved by the study-tools page.
    public struct Glance: Equatable, Sendable {
        public var tasksToday: Int
        public var overdue: Int
        public var next: String
        public var cardsDue: Int
        public var decks: [String]

        /// Reads the saved summary; nil when it is missing, malformed or from another day.
        public static func parse(_ text: String?, today: String) -> Glance? {
            guard let text, let json = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
                  json["schema"] as? Int == 1, json["date"] as? String == today,
                  let tasks = json["tasksToday"] as? Int, let overdue = json["overdue"] as? Int, let cards = json["cardsDue"] as? Int,
                  tasks >= 0, overdue >= 0, cards >= 0 else { return nil }
            let decks = (json["decks"] as? [String] ?? []).prefix(3).map { String($0.prefix(60)) }
            return Glance(tasksToday: tasks, overdue: overdue, next: String((json["next"] as? String ?? "").prefix(120)), cardsDue: cards, decks: Array(decks))
        }
    }

    static func glanceSection(_ glance: Glance?) -> String {
        guard let glance, glance.tasksToday + glance.overdue + glance.cardsDue > 0 else { return "" }
        let plural = { (count: Int, word: String) in "\(count) \(word)\(count == 1 ? "" : "s")" }
        let taskDetail = [glance.overdue > 0 ? "\(glance.overdue) overdue" : nil, glance.next.isEmpty ? nil : glance.next]
            .compactMap { $0 }.joined(separator: " · ")
        let calendar = #"<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/></svg>"#
        let cards = #"<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2" y="4" width="10" height="9" rx="1.5"/><path d="M5 2h8.5a.5.5 0 0 1 .5.5V10"/></svg>"#
        var items: [String] = []
        if glance.tasksToday + glance.overdue > 0 {
            items.append(#"<div class="glance"><span class="gicon violet">\#(calendar)</span><div><strong>\#(escape(plural(glance.tasksToday, "task"))) today</strong><span>\#(escape(taskDetail))</span></div></div>"#)
        }
        if glance.cardsDue > 0 {
            items.append(#"<div class="glance"><span class="gicon amber">\#(cards)</span><div><strong>\#(escape(plural(glance.cardsDue, "flashcard"))) due</strong><span>\#(escape(glance.decks.joined(separator: " · ")))</span></div></div>"#)
        }
        return #"<section class="glances" aria-label="Today">\#(items.joined())</section>"#
    }

    /// The address new tabs load. Served by the app, so Back and Reload work.
    public static let scheme = "aster-start"
    public static let url = URL(string: "aster-start://home/")!

    public static func isStartPage(_ url: URL?) -> Bool {
        url?.scheme?.lowercased() == scheme
    }

    public static func html(workspace: String, isPrivate: Bool, provider: SearchProvider, bookmarks: [BookmarkFile.Bookmark],
                            glance: Glance? = nil, version: String? = nil) -> String {
        let form = searchForm(for: provider) ?? searchForm(for: .fallback)!
        let tiles = bookmarks.prefix(12).map { bookmark -> String in
            let mark = monogram(for: bookmark)
            return """
            <a class="tile" href="\(escape(bookmark.url.absoluteString))" title="\(escape(bookmark.url.absoluteString))"><span class="mono" style="background:\(mark.background);color:\(mark.foreground)">\(escape(mark.letter))</span><span class="name">\(escape(bookmark.title))</span></a>
            """
        }.joined()
        let bookmarkSection = tiles.isEmpty
            ? #"<p class="hint">Press ⌘D on any page to bookmark it. Your bookmarks will appear here.</p>"#
            : #"<h2>Bookmarks</h2><nav class="tiles" aria-label="Bookmarks">\#(tiles)</nav>"#
        let subtitle = isPrivate ? "Private window: pages you visit here aren't saved." : "\(escape(workspace)) workspace"
        return """
        <!doctype html>
        <html lang="en"><head><meta charset="utf-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action https:; base-uri 'none'">
        <meta name="color-scheme" content="light dark">
        <title>New Tab</title>
        <style>
        :root{--bg:#fbfbfd;--surface:#fff;--text:#1d1d1f;--muted:#6e6e73;--line:#e3e1ea;--accent:#6e56cf}
        @media (prefers-color-scheme: dark){:root{--bg:#1c1b21;--surface:#2b2a31;--text:#f2f2f7;--muted:#a1a1a8;--line:#3a3942;--accent:#8b76e8}}
        \(isPrivate ? ":root{--bg:#18171d;--surface:#26252c;--text:#f2f2f7;--muted:#a1a1a8;--line:#36353d;--accent:#8b76e8}" : "")
        *{box-sizing:border-box}
        body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font:14px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;padding:12vh 24px 48px;gap:36px}
        header{display:flex;flex-direction:column;align-items:center;gap:12px}
        header p{margin:0;color:var(--muted);font-size:13px}
        form{width:100%;max-width:560px;display:flex;align-items:center;gap:10px;height:52px;padding:0 8px 0 18px;border-radius:14px;background:var(--surface);box-shadow:0 1px 3px rgba(20,16,40,.08),0 0 0 1px var(--line)}
        form:focus-within{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 45%,transparent)}
        input{flex:1;min-width:0;border:0;background:transparent;color:var(--text);font:inherit;font-size:16px;outline:none}
        button{height:36px;padding:0 16px;border:0;border-radius:10px;background:var(--accent);color:#fff;font:inherit;font-size:13px;font-weight:600;cursor:pointer}
        section{width:100%;max-width:720px}
        h2{margin:0 0 12px;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
        .tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px}
        .tile{display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 6px;border-radius:12px;color:var(--text);text-decoration:none}
        .tile:hover,.tile:focus-visible{background:var(--surface);box-shadow:0 0 0 1px var(--line);outline:none}
        .mono{width:52px;height:52px;border-radius:12px;display:grid;place-items:center;font-size:20px;font-weight:700}
        .name{font-size:12px;text-align:center;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .hint{color:var(--muted);text-align:center;font-size:13px}
        footer{margin-top:auto;padding-top:24px;color:var(--muted);font-size:11px}
        .glances{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
        .glance{display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px;background:var(--surface);box-shadow:0 0 0 1px var(--line)}
        .glance strong{display:block;font-size:13px}.glance span{display:block;font-size:12px;color:var(--muted)}
        .gicon{flex:none;width:36px;height:36px;border-radius:10px;display:grid!important;place-items:center}
        .gicon svg{width:18px;height:18px}.violet{background:#eeeafc;color:#5b45c2!important}.amber{background:#fdf0dc;color:#9a5b00!important}
        </style></head>
        <body>
        <header>
        <svg width="56" height="56" viewBox="0 0 64 64" role="img" aria-label="Aster"><rect width="64" height="64" rx="15" fill="#6e56cf"/><g fill="#fff"><ellipse cx="32" cy="17" rx="4.5" ry="10"/><ellipse cx="32" cy="47" rx="4.5" ry="10"/><ellipse cx="17" cy="32" rx="10" ry="4.5"/><ellipse cx="47" cy="32" rx="10" ry="4.5"/><ellipse cx="21.4" cy="21.4" rx="4.5" ry="10" transform="rotate(-45 21.4 21.4)"/><ellipse cx="42.6" cy="42.6" rx="4.5" ry="10" transform="rotate(-45 42.6 42.6)"/><ellipse cx="42.6" cy="21.4" rx="4.5" ry="10" transform="rotate(45 42.6 21.4)"/><ellipse cx="21.4" cy="42.6" rx="4.5" ry="10" transform="rotate(45 21.4 42.6)"/></g><circle cx="32" cy="32" r="7" fill="#f5b83d"/></svg>
        <p>\(subtitle)</p>
        </header>
        <form action="\(escape(form.action))" method="get" role="search">
        <input name="\(escape(form.field))" placeholder="Search with \(escape(provider.name))" aria-label="Search with \(escape(provider.name))" autocomplete="off">
        <button type="submit">Search</button>
        </form>
        <section>\(bookmarkSection)</section>
        \(isPrivate ? "" : glanceSection(glance))
        \(version.map { "<footer>Aster \(escape($0))</footer>" } ?? "")
        </body></html>
        """
    }
}

// MARK: - Updates

/// A `major.minor.patch` version, as in "0.5.0" or the tag "v0.5.0".
public struct SemanticVersion: Comparable, CustomStringConvertible, Sendable {
    public let major: Int
    public let minor: Int
    public let patch: Int

    public init?(_ text: String) {
        var value = text.trimmingCharacters(in: .whitespaces)
        if value.hasPrefix("v") || value.hasPrefix("V") { value.removeFirst() }
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3, let major = Int(parts[0]), let minor = Int(parts[1]), let patch = Int(parts[2]),
              major >= 0, minor >= 0, patch >= 0, parts.allSatisfy({ $0.allSatisfy(\.isNumber) }) else { return nil }
        self.major = major
        self.minor = minor
        self.patch = patch
    }

    public var description: String { "\(major).\(minor).\(patch)" }

    public static func < (lhs: SemanticVersion, rhs: SemanticVersion) -> Bool {
        (lhs.major, lhs.minor, lhs.patch) < (rhs.major, rhs.minor, rhs.patch)
    }
}

/// The parts of a GitHub release that the updater uses.
public struct ReleaseInfo: Equatable, Sendable {
    public struct Asset: Equatable, Sendable {
        public let name: String
        public let url: URL
        /// Bytes, or 0 when not known in advance.
        public let size: Int
        /// GitHub's own SHA-256 of the file, from the asset's "digest" field.
        public let sha256: String?
    }

    public let version: SemanticVersion
    public let notes: String
    public let page: URL?
    public let assets: [Asset]

    public static func == (lhs: ReleaseInfo, rhs: ReleaseInfo) -> Bool {
        lhs.version == rhs.version && lhs.notes == rhs.notes && lhs.page == rhs.page && lhs.assets == rhs.assets
    }

    /// Builds a release from the address `…/releases/latest` redirects to
    /// (`…/releases/tag/v1.2.3`). Used when GitHub's API is unavailable, for
    /// example when a shared network has used up its hourly API allowance.
    /// Asset addresses follow the release workflow's fixed naming; the
    /// checksum then comes from the release's SHA256SUMS.txt.
    public static func fromLatestRedirect(_ url: URL?, repository: String) -> ReleaseInfo? {
        guard let url, url.scheme == "https", url.host?.lowercased() == "github.com" else { return nil }
        let parts = url.path.split(separator: "/").map(String.init)
        guard parts.count == 5, "\(parts[0])/\(parts[1])" == repository, parts[2] == "releases", parts[3] == "tag",
              let version = SemanticVersion(parts[4]) else { return nil }
        let base = "https://github.com/\(repository)/releases/download/v\(version)"
        guard let dmg = URL(string: "\(base)/Aster-\(version).dmg"), let sums = URL(string: "\(base)/SHA256SUMS.txt") else { return nil }
        return ReleaseInfo(version: version, notes: "", page: url, assets: [
            Asset(name: "Aster-\(version).dmg", url: dmg, size: 0, sha256: nil),
            Asset(name: "SHA256SUMS.txt", url: sums, size: 0, sha256: nil),
        ])
    }

    /// Parses GitHub's `GET /repos/{owner}/{repo}/releases/latest` response.
    /// Drafts and pre-releases are ignored, as are malformed assets.
    public static func parse(_ data: Data) -> ReleaseInfo? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              json["draft"] as? Bool != true, json["prerelease"] as? Bool != true,
              let tag = json["tag_name"] as? String, let version = SemanticVersion(tag) else { return nil }
        let assets = (json["assets"] as? [[String: Any]] ?? []).compactMap { item -> Asset? in
            guard let name = item["name"] as? String, let link = item["browser_download_url"] as? String,
                  let url = URL(string: link), let size = item["size"] as? Int else { return nil }
            var sha: String?
            if let digest = item["digest"] as? String, digest.hasPrefix("sha256:") {
                let hex = String(digest.dropFirst(7)).lowercased()
                if hex.count == 64, hex.allSatisfy(\.isHexDigit) { sha = hex }
            }
            return Asset(name: name, url: url, size: size, sha256: sha)
        }
        let notes = String((json["body"] as? String ?? "").prefix(4000))
        return ReleaseInfo(version: version, notes: notes, page: (json["html_url"] as? String).flatMap(URL.init(string:)), assets: assets)
    }
}

public enum UpdatePolicy {
    /// Hosts the disk image may be downloaded from (GitHub release downloads).
    public static let downloadHosts: Set<String> = ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]
    public static let maxDownloadBytes = 300 * 1024 * 1024

    /// The release's `Aster-<version>.dmg`, if it is a sensible HTTPS GitHub download.
    public static func diskImage(in release: ReleaseInfo) -> ReleaseInfo.Asset? {
        release.assets.first { asset in
            asset.name == "Aster-\(release.version).dmg" && asset.url.scheme == "https"
                && downloadHosts.contains(asset.url.host?.lowercased() ?? "") && asset.size >= 0 && asset.size <= maxDownloadBytes
        }
    }

    /// The expected SHA-256 for `assetName`: GitHub's digest if present, else
    /// the line for it in the release's SHA256SUMS.txt.
    public static func expectedSHA256(for asset: ReleaseInfo.Asset, sums: String?) -> String? {
        if let sha = asset.sha256 { return sha }
        guard let sums else { return nil }
        for line in sums.split(whereSeparator: \.isNewline) {
            let fields = line.split(separator: " ", omittingEmptySubsequences: true)
            if fields.count == 2, fields[1] == Substring(asset.name), fields[0].count == 64, fields[0].allSatisfy(\.isHexDigit) {
                return fields[0].lowercased()
            }
        }
        return nil
    }

    /// Updates can't replace an app running from a disk image or from macOS's
    /// randomised "App Translocation" location.
    public static func canReplaceApp(at url: URL) -> Bool {
        let path = url.standardizedFileURL.path
        return !path.contains("/AppTranslocation/") && !path.hasPrefix("/Volumes/")
    }
}
