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
