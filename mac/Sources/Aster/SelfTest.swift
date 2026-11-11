// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
import AppKit
import AsterKit
import WebKit

/// `Aster --self-test`: launches the real app machinery without showing
/// windows, exercises the bundled tools page, the native storage bridge and
/// citation extraction, prints the result and exits (0 = passed).
@MainActor
enum SelfTest {
    private static var keepAlive: [AnyObject] = []

    static func start() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 120) {
            print("SELF-TEST FAILED: timed out")
            exit(2)
        }
        Task { @MainActor in
            do {
                try await run()
                print("SELF-TEST PASSED")
                exit(0)
            } catch {
                print("SELF-TEST FAILED: \(error.localizedDescription)")
                exit(1)
            }
        }
    }

    private static func check(_ condition: Bool, _ name: String) throws {
        guard condition else { throw ToolsError(message: name) }
        print("  ok  \(name)")
    }

    private static func waitUntil(_ what: String, timeout: TimeInterval = 30, _ condition: () async throws -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if (try? await condition()) == true { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        throw ToolsError(message: "timed out waiting for \(what)")
    }

    private static func offscreen(_ view: NSView) {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 700), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = view
        keepAlive.append(window)
    }

    private static func run() async throws {
        print("Aster self-test, version \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") ?? "?")")
        try check(AddressInput.resolve("example.org", provider: .fallback)?.absoluteString == "https://example.org", "address bar")

        // 1. Study-tools page served from the app bundle, with real storage.
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("aster-self-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        ToolsHub.shared.store = ToolsStore(directory: directory)
        let panel = ToolsPanel(owner: nil)
        keepAlive.append(panel)
        offscreen(panel.webView)
        panel.load()
        try await waitUntil("the tools page") {
            try await panel.webView.runJavaScript("return document.documentElement.dataset.ready === 'true';") as? Bool == true
        }
        try check(true, "tools page and ES modules load over aster://")
        let result = try await panel.webView.runJavaScript("return await window.asterTools.selfTest();") as? [String: Any]
        try check(result?["ok"] as? Bool == true, "tools self-test (\((result?["checks"] as? [String])?.joined(separator: ", ") ?? "-"))")
        try check(try ToolsHub.shared.store.load("self-test") == "ok ✓", "native storage bridge wrote to disk")
        let served = try await panel.webView.runJavaScript("""
            const inside = await fetch('aster://app/tools.css').then(r => r.ok, () => false);
            const outside = await fetch('aster://app/../../Info.plist').then(r => r.ok, () => false);
            const encoded = await fetch('aster://app/%2E%2E/%2E%2E/Info.plist').then(r => r.ok, () => false);
            return [inside, outside, encoded].join(',');
            """) as? String
        try check(served == "true,false,false", "bundle files are served; files outside the web folder are not (\(served ?? "-"))")

        // 2. Citation extraction in an isolated world of an ordinary page.
        let pane = BrowserPane(context: .makePrivate())
        keepAlive.append(pane)
        offscreen(pane.webView)
        let before = BrowserPane.navigationDecisions
        let fixture = """
        <!doctype html><html><head><title>Fallback title</title>
        <meta name="citation_title" content="Railways and Trade">
        <meta name="citation_author" content="Ada Lovelace">
        <meta name="citation_publication_date" content="2024/02/29">
        <meta name="citation_doi" content="10.1234/example">
        <meta property="og:site_name" content="History Review">
        <script>window.extractPageMetadata = () => ({title: 'Spoofed by page'});</script>
        </head><body><p>Article</p></body></html>
        """
        pane.webView.loadHTMLString(fixture, baseURL: URL(string: "https://example.org/articles/railways"))
        try await waitUntil("the test page") { !pane.webView.isLoading && pane.webView.url?.host == "example.org" }
        try check(BrowserPane.navigationDecisions > before, "navigation delegate is connected")
        let metadata = try await CitationRunner.extract(from: pane.webView)
        try check(metadata["title"] as? String == "Railways and Trade", "citation title (page script could not spoof it)")
        try check(metadata["authors"] as? [String] == ["Ada Lovelace"], "citation authors")
        try check(metadata["doi"] as? String == "10.1234/example", "citation DOI")
        try check((metadata["issued"] as? [Int]) == [2024, 2, 29], "citation date")
        let leaked = try await pane.webView.runJavaScript("return typeof clean;") as? String
        try check(leaked == "undefined", "citation code is invisible to the page")
    }
}
