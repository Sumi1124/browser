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
