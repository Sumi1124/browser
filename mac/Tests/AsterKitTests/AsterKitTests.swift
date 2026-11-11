import XCTest
@testable import AsterKit

final class AddressInputTests: XCTestCase {
    let google = SearchProvider.provider(id: "google")

    func resolve(_ text: String) -> String? { AddressInput.resolve(text, provider: google)?.absoluteString }

    func testWebAddresses() {
        XCTAssertEqual(resolve("https://example.org/a?b=1"), "https://example.org/a?b=1")
        XCTAssertEqual(resolve("example.org"), "https://example.org")
        XCTAssertEqual(resolve("  en.wikipedia.org/wiki/Aster  "), "https://en.wikipedia.org/wiki/Aster")
        XCTAssertEqual(resolve("localhost:8080"), "http://localhost:8080")
        XCTAssertEqual(resolve("192.168.1.10"), "http://192.168.1.10")
        XCTAssertEqual(resolve("about:blank"), "about:blank")
    }

    func testSearches() {
        XCTAssertEqual(resolve("photosynthesis"), "https://www.google.com/search?q=photosynthesis")
        XCTAssertEqual(resolve("what is 2+2 & why"), "https://www.google.com/search?q=what%20is%202%2B2%20%26%20why")
        XCTAssertEqual(resolve("1.5"), "https://www.google.com/search?q=1.5")
        XCTAssertEqual(resolve("javascript:alert(1)"), "https://www.google.com/search?q=javascript%3Aalert%281%29")
        XCTAssertEqual(resolve("file:///etc/passwd"), "https://www.google.com/search?q=file%3A%2F%2F%2Fetc%2Fpasswd")
        XCTAssertEqual(resolve("data:text/html,hi"), "https://www.google.com/search?q=data%3Atext%2Fhtml%2Chi")
        XCTAssertNil(resolve("   "))
    }

    func testProvidersMatchTheCore() {
        XCTAssertEqual(SearchProvider.all.map(\.id), ["google", "duckduckgo", "bing", "brave", "yahoo", "ecosia"])
        XCTAssertEqual(SearchProvider.provider(id: "nope"), SearchProvider.fallback)
        XCTAssertEqual(SearchProvider.provider(id: "yahoo").url(for: "a#b")?.absoluteString, "https://search.yahoo.com/search?p=a%23b")
        XCTAssertNil(google.url(for: String(repeating: "x", count: 3000)))
    }
}

final class ToolsStoreTests: XCTestCase {
    func testRoundTripAndKeyValidation() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = ToolsStore(directory: dir)
        XCTAssertNil(try store.load("planner"))
        try store.save("planner", text: "{\"schema\":1} ✓")
        XCTAssertEqual(try store.load("planner"), "{\"schema\":1} ✓")
        for key in ["../x", "Planner", "a/b", "", "x.json", String(repeating: "a", count: 40)] {
            XCTAssertThrowsError(try store.save(key, text: "x"), key)
        }
        let attributes = try FileManager.default.attributesOfItem(atPath: dir.appendingPathComponent("planner.json").path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)
    }
}

final class CitationScriptTests: XCTestCase {
    func testWrapsModuleAndRejectsImports() {
        let body = CitationScript.functionBody(fromModule: "const a = 1;\nexport function extractPageMetadata(d, u) { return {a}; }\n")
        XCTAssertEqual(body?.contains("export"), false)
        XCTAssertEqual(body?.hasSuffix("return extractPageMetadata(document, location.href);\n"), true)
        XCTAssertNil(CitationScript.functionBody(fromModule: "import x from './y.mjs';"))
        XCTAssertNil(CitationScript.functionBody(fromModule: "export const x = 1;"))
    }
}

final class FileNameTests: XCTestCase {
    func testSanitize() {
        XCTAssertEqual(FileNames.sanitize("../../.ssh/id_rsa"), "id_rsa")
        XCTAssertEqual(FileNames.sanitize("..hidden"), "hidden")
        XCTAssertEqual(FileNames.sanitize("re\u{0007}port.pdf"), "report.pdf")
        XCTAssertEqual(FileNames.sanitize("   "), "download")
        XCTAssertEqual(FileNames.sanitize("C:\\evil\\a.txt"), "a.txt")
    }

    func testUnique() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        XCTAssertEqual(FileNames.unique("a.pdf", in: dir).lastPathComponent, "a.pdf")
        FileManager.default.createFile(atPath: dir.appendingPathComponent("a.pdf").path, contents: Data())
        XCTAssertEqual(FileNames.unique("a.pdf", in: dir).lastPathComponent, "a 2.pdf")
    }
}

final class BookmarkFileTests: XCTestCase {
    private func makeStore() -> (ToolsStore, URL) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        return (ToolsStore(directory: dir), dir)
    }

    func testKeysMatchTheJavaScriptRule() {
        XCTAssertEqual(BookmarkFile.key(URL(string: "https://Example.org/")!), "https://example.org")
        XCTAssertEqual(BookmarkFile.key(URL(string: "https://example.org/a/#top")!), "https://example.org/a")
        XCTAssertNotEqual(BookmarkFile.key(URL(string: "https://example.org/a?x=1")!), BookmarkFile.key(URL(string: "https://example.org/a?x=2")!))
        XCTAssertNil(BookmarkFile.key(URL(string: "javascript:alert(1)")!))
        XCTAssertNil(BookmarkFile.key(URL(string: "file:///etc/passwd")!))
        XCTAssertNil(BookmarkFile.key(URL(string: "https://user:pw@example.org/")!))
    }

    func testAddContainsRemoveAndPreservation() throws {
        let (store, dir) = makeStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        // A file written by the study-tools page, with a folder and an extra field.
        try store.save("bookmarks", text: #"{"schema":1,"folders":[{"id":"f","name":"Maths"}],"bookmarks":[{"id":"a","url":"https://www.desmos.com/calculator","title":"Desmos","folderId":"f","addedAt":"2026-11-11T10:00:00Z","note":"keep me"}]}"#)
        let file = BookmarkFile(store: store)
        XCTAssertTrue(file.contains(URL(string: "https://www.desmos.com/calculator/#x")!))
        XCTAssertTrue(try file.add(url: URL(string: "https://ibo.org")!, title: "  International\n Baccalaureate ", now: Date(timeIntervalSince1970: 0)))
        XCTAssertFalse(try file.add(url: URL(string: "https://ibo.org/")!, title: "Again"))
        XCTAssertThrowsError(try file.add(url: URL(string: "javascript:alert(1)")!, title: "x"))
        let contents = try file.read()
        XCTAssertEqual(contents.folders, [BookmarkFile.Folder(id: "f", name: "Maths")])
        XCTAssertEqual(contents.bookmarks.map(\.title), ["Desmos", "International Baccalaureate"])
        let saved = try XCTUnwrap(store.load("bookmarks"))
        XCTAssertTrue(saved.contains("\"note\":\"keep me\""))
        XCTAssertTrue(saved.contains("\"addedAt\":\"1970-01-01T00:00:00Z\""))
        XCTAssertTrue(try file.remove(url: URL(string: "https://ibo.org")!))
        XCTAssertFalse(file.contains(URL(string: "https://ibo.org")!))
        XCTAssertFalse(try file.remove(url: URL(string: "https://ibo.org")!))
    }

    func testUnreadableFileIsNeverOverwritten() throws {
        let (store, dir) = makeStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        try store.save("bookmarks", text: "{not json")
        let file = BookmarkFile(store: store)
        XCTAssertThrowsError(try file.add(url: URL(string: "https://example.org")!, title: "x")) { error in
            XCTAssertEqual(error as? BookmarkError, .unreadable)
        }
        XCTAssertEqual(try store.load("bookmarks"), "{not json")
        XCTAssertFalse(file.contains(URL(string: "https://example.org")!))
    }
}

final class StartPageTests: XCTestCase {
    func testSearchFormsForEveryProvider() {
        XCTAssertEqual(StartPage.searchForm(for: .provider(id: "google"))?.action, "https://www.google.com/search")
        XCTAssertEqual(StartPage.searchForm(for: .provider(id: "google"))?.field, "q")
        XCTAssertEqual(StartPage.searchForm(for: .provider(id: "yahoo"))?.field, "p")
        for provider in SearchProvider.all { XCTAssertNotNil(StartPage.searchForm(for: provider), provider.id) }
    }

    func testBookmarksAreEscaped() {
        let evil = BookmarkFile.Bookmark(id: "a", title: "<script>alert(1)</script>\" onmouseover=\"x", url: URL(string: "https://example.org/?a=1&b=\"2\"")!, folderId: nil)
        let html = StartPage.html(workspace: "Tom & Jerry", isPrivate: false, provider: .provider(id: "duckduckgo"), bookmarks: [evil])
        XCTAssertFalse(html.contains("<script>"))
        XCTAssertFalse(html.contains("\" onmouseover=\"x"))
        XCTAssertTrue(html.contains("&lt;script&gt;"))
        XCTAssertTrue(html.contains("Tom &amp; Jerry workspace"))
        XCTAssertTrue(html.contains(#"action="https://duckduckgo.com/""#))
        XCTAssertTrue(html.contains("default-src 'none'"), "the start page runs no scripts")
        let empty = StartPage.html(workspace: "Personal", isPrivate: true, provider: .fallback, bookmarks: [])
        XCTAssertTrue(empty.contains("Press ⌘D"))
        XCTAssertTrue(empty.contains("Private window"))
    }
}

final class MonogramTests: XCTestCase {
    func testLetterComesFromTheName() {
        let wiki = BookmarkFile.Bookmark(id: "w", title: "Industrial Revolution", url: URL(string: "https://en.wikipedia.org/wiki/Industrial_Revolution")!, folderId: nil)
        XCTAssertEqual(StartPage.monogram(for: wiki).letter, "I")
        let quoted = BookmarkFile.Bookmark(id: "q", title: "“PhET” sims", url: URL(string: "https://phet.colorado.edu")!, folderId: nil)
        XCTAssertEqual(StartPage.monogram(for: quoted).letter, "P")
    }
}

final class UpdateTests: XCTestCase {
    func testVersions() {
        XCTAssertEqual(SemanticVersion("v0.6.0")?.description, "0.6.0")
        XCTAssertTrue(SemanticVersion("0.5.0")! < SemanticVersion("0.6.0")!)
        XCTAssertTrue(SemanticVersion("0.9.9")! < SemanticVersion("0.10.0")!)
        XCTAssertFalse(SemanticVersion("1.0.0")! < SemanticVersion("1.0.0")!)
        for bad in ["", "1.0", "1.0.0.0", "1.0.x", "-1.0.0", "1.0.0-beta", "v"] { XCTAssertNil(SemanticVersion(bad), bad) }
    }

    private func release(_ extra: String = "") -> Data {
        Data(#"""
        {"tag_name":"v0.6.0","draft":false,"prerelease":false,"html_url":"https://github.com/Sumi1124/browser/releases/tag/v0.6.0","body":"Notes",\#(extra)
         "assets":[
          {"name":"Aster-0.6.0.dmg","size":941532,"browser_download_url":"https://github.com/Sumi1124/browser/releases/download/v0.6.0/Aster-0.6.0.dmg","digest":"sha256:AB4ECE821A3B36472586EA75D4567C4B321E1B8840D15006C9E96B590160066F"},
          {"name":"SHA256SUMS.txt","size":367,"browser_download_url":"https://github.com/Sumi1124/browser/releases/download/v0.6.0/SHA256SUMS.txt"},
          {"name":"broken"}]}
        """#.utf8)
    }

    func testParsesReleaseAndPicksTheDiskImage() throws {
        let info = try XCTUnwrap(ReleaseInfo.parse(release()))
        XCTAssertEqual(info.version.description, "0.6.0")
        XCTAssertEqual(info.assets.count, 2)
        let dmg = try XCTUnwrap(UpdatePolicy.diskImage(in: info))
        XCTAssertEqual(dmg.sha256, "ab4ece821a3b36472586ea75d4567c4b321e1b8840d15006c9e96b590160066f")
        XCTAssertEqual(UpdatePolicy.expectedSHA256(for: dmg, sums: nil), dmg.sha256)
        XCTAssertNil(ReleaseInfo.parse(Data(#"{"tag_name":"v0.6.0","prerelease":true,"assets":[]}"#.utf8)), "pre-releases are ignored")
        XCTAssertNil(ReleaseInfo.parse(Data(#"{"tag_name":"latest","assets":[]}"#.utf8)))
    }

    func testRejectsUnsafeDownloads() {
        let make = { (url: String, size: Int) in
            ReleaseInfo(version: SemanticVersion("1.0.0")!, notes: "", page: nil,
                        assets: [.init(name: "Aster-1.0.0.dmg", url: URL(string: url)!, size: size, sha256: nil)])
        }
        XCTAssertNotNil(UpdatePolicy.diskImage(in: make("https://github.com/a/b/releases/download/v1.0.0/Aster-1.0.0.dmg", 10)))
        XCTAssertNil(UpdatePolicy.diskImage(in: make("http://github.com/x.dmg", 10)), "plain HTTP")
        XCTAssertNil(UpdatePolicy.diskImage(in: make("https://evil.example/Aster-1.0.0.dmg", 10)), "other host")
        XCTAssertNil(UpdatePolicy.diskImage(in: make("https://github.com/x.dmg", 0)), "empty")
        XCTAssertNil(UpdatePolicy.diskImage(in: make("https://github.com/x.dmg", 400 * 1024 * 1024)), "too large")
    }

    func testChecksumFallbackAndAppLocation() {
        let asset = ReleaseInfo.Asset(name: "Aster-1.0.0.dmg", url: URL(string: "https://github.com/x")!, size: 1, sha256: nil)
        let sums = "\(String(repeating: "a", count: 64))  Aster-1.0.0.dmg\n\(String(repeating: "b", count: 64))  other.zip\n"
        XCTAssertEqual(UpdatePolicy.expectedSHA256(for: asset, sums: sums), String(repeating: "a", count: 64))
        XCTAssertNil(UpdatePolicy.expectedSHA256(for: asset, sums: "nothing here"))
        XCTAssertTrue(UpdatePolicy.canReplaceApp(at: URL(fileURLWithPath: "/Applications/Aster.app")))
        XCTAssertFalse(UpdatePolicy.canReplaceApp(at: URL(fileURLWithPath: "/Volumes/Aster 0.5.0/Aster.app")))
        XCTAssertFalse(UpdatePolicy.canReplaceApp(at: URL(fileURLWithPath: "/private/var/folders/x/AppTranslocation/ABC/d/Aster.app")))
    }
}
