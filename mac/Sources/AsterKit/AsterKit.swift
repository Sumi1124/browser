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
        var label = bookmark.url.host ?? bookmark.title
        if label.hasPrefix("www.") { label.removeFirst(4) }
        var hash: UInt32 = 0
        for scalar in label.unicodeScalars { hash = hash &* 31 &+ scalar.value }
        let colors = palette[Int(hash % UInt32(palette.count))]
        return (label.first.map { String($0).uppercased() } ?? "?", colors.0, colors.1)
    }

    public static func html(workspace: String, isPrivate: Bool, provider: SearchProvider, bookmarks: [BookmarkFile.Bookmark]) -> String {
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
        </body></html>
        """
    }
}
