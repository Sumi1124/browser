// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
import AppKit
import AsterKit
import CryptoKit

struct UpdateError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

/// Checks GitHub Releases for a newer Aster and installs it in place.
///
/// Trust: the release information and the disk image come from GitHub over
/// HTTPS. Before anything is replaced, the download must match the SHA-256
/// that GitHub reports for it, the app inside must be Aster (same bundle ID,
/// the advertised version) and its code signature must verify.
@MainActor
final class Updater: NSObject {
    static let shared = Updater()
    static let releaseAPI = URL(string: "https://api.github.com/repos/Sumi1124/browser/releases/latest")!
    static let releasesPage = URL(string: "https://github.com/Sumi1124/browser/releases/latest")!

    private let defaults = UserDefaults.standard
    private var busy = false
    private var progressPanel: NSPanel?
    private var timer: Timer?

    var automaticChecks: Bool {
        get { defaults.object(forKey: "updatesCheckAutomatically") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "updatesCheckAutomatically") }
    }

    var currentVersion: SemanticVersion {
        SemanticVersion(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") ?? SemanticVersion("0.0.0")!
    }

    // MARK: Checking

    /// Checks shortly after launch and then every few hours, at most once a day.
    func startAutomaticChecks() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in self?.checkIfDue() }
        timer = Timer.scheduledTimer(withTimeInterval: 6 * 3600, repeats: true) { [weak self] _ in
            DispatchQueue.main.async { self?.checkIfDue() }
        }
    }

    private func checkIfDue() {
        guard automaticChecks else { return }
        let last = defaults.double(forKey: "updatesLastCheck")
        guard Date().timeIntervalSince1970 - last > 20 * 3600 else { return }
        Task { await check(userInitiated: false) }
    }

    func check(userInitiated: Bool) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let release = try await Self.fetchLatest()
            defaults.set(Date().timeIntervalSince1970, forKey: "updatesLastCheck")
            guard release.version > currentVersion else {
                if userInitiated { inform("You're up to date", "Aster \(currentVersion) is the newest version.") }
                return
            }
            if !userInitiated, defaults.string(forKey: "updatesSkippedVersion") == release.version.description { return }
            offer(release)
        } catch {
            if userInitiated { inform("Couldn't check for updates", error.localizedDescription) }
        }
    }

    nonisolated static func fetchLatest() async throws -> ReleaseInfo {
        var request = URLRequest(url: releaseAPI, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("Aster-Updater", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200, let release = ReleaseInfo.parse(data) else {
            throw UpdateError("GitHub didn't return a usable release. Try again later.")
        }
        return release
    }

    // MARK: Asking

    private func offer(_ release: ReleaseInfo) {
        let alert = NSAlert()
        alert.messageText = "Aster \(release.version) is available"
        alert.informativeText = "You have Aster \(currentVersion). Installing takes a few seconds; Aster then quits and reopens. Your study tools and bookmarks are kept."
        if !release.notes.isEmpty {
            let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 420, height: 180))
            scroll.hasVerticalScroller = true
            scroll.borderType = .bezelBorder
            let text = NSTextView(frame: scroll.bounds)
            text.isEditable = false
            text.string = release.notes
            text.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
            text.textContainerInset = NSSize(width: 6, height: 6)
            text.autoresizingMask = [.width]
            scroll.documentView = text
            alert.accessoryView = scroll
        }
        alert.addButton(withTitle: "Install and Relaunch")
        alert.addButton(withTitle: "Later")
        alert.addButton(withTitle: "Skip This Version")
        NSApp.activate(ignoringOtherApps: true)
        switch alert.runModal() {
        case .alertFirstButtonReturn: Task { await install(release) }
        case .alertThirdButtonReturn: defaults.set(release.version.description, forKey: "updatesSkippedVersion")
        default: break
        }
    }

    private func inform(_ title: String, _ message: String, offerDownloadPage: Bool = false) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        if offerDownloadPage { alert.addButton(withTitle: "Open Download Page") }
        if alert.runModal() == .alertSecondButtonReturn { NSWorkspace.shared.open(Self.releasesPage) }
    }

    // MARK: Installing

    private func install(_ release: ReleaseInfo) async {
        let appURL = Bundle.main.bundleURL
        guard UpdatePolicy.canReplaceApp(at: appURL) else {
            inform("Move Aster to Applications first",
                   "Aster is running from the disk image or a temporary location, so it can't update itself. Drag Aster into the Applications folder, open it from there, and try again.")
            return
        }
        guard let asset = UpdatePolicy.diskImage(in: release) else {
            inform("This update can't be installed automatically", "The release has no Aster disk image. You can download it yourself.", offerDownloadPage: true)
            return
        }
        showProgress("Downloading Aster \(release.version)…")
        do {
            var sums: String?
            if asset.sha256 == nil, let file = release.assets.first(where: { $0.name == "SHA256SUMS.txt" }),
               UpdatePolicy.downloadHosts.contains(file.url.host?.lowercased() ?? "") {
                sums = String(decoding: try await URLSession.shared.data(from: file.url).0, as: UTF8.self)
            }
            guard let expected = UpdatePolicy.expectedSHA256(for: asset, sums: sums) else {
                throw UpdateError("The release has no checksum, so the download can't be verified.")
            }
            let (temporary, response) = try await URLSession.shared.download(from: asset.url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw UpdateError("The download failed. Try again later.") }
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("aster-update-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: folder) }
            let diskImage = folder.appendingPathComponent(asset.name)
            try FileManager.default.moveItem(at: temporary, to: diskImage)
            updateProgress("Installing Aster \(release.version)…")
            try await Task.detached(priority: .userInitiated) {
                try Updater.install(diskImage: diskImage, expectedSHA256: expected, expectedVersion: release.version, replacing: appURL)
            }.value
            hideProgress()
            relaunch(appURL)
        } catch {
            hideProgress()
            inform("The update couldn't be installed", "\(error.localizedDescription)\n\nYou can download it yourself instead.", offerDownloadPage: true)
        }
    }

    /// Verifies `diskImage` and swaps the Aster.app inside it in for `appURL`.
    /// Nothing is replaced unless every check passes.
    nonisolated static func install(diskImage: URL, expectedSHA256: String, expectedVersion: SemanticVersion, replacing appURL: URL) throws {
        guard try sha256(of: diskImage) == expectedSHA256.lowercased() else {
            throw UpdateError("The download is damaged: its fingerprint doesn't match the one GitHub published.")
        }
        let mount = FileManager.default.temporaryDirectory.appendingPathComponent("aster-mount-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: mount, withIntermediateDirectories: true)
        try run("/usr/bin/hdiutil", ["attach", diskImage.path, "-nobrowse", "-readonly", "-noautoopen", "-noverify", "-mountpoint", mount.path])
        defer {
            _ = try? run("/usr/bin/hdiutil", ["detach", mount.path, "-force"])
            try? FileManager.default.removeItem(at: mount)
        }
        let newApp = mount.appendingPathComponent("Aster.app", isDirectory: true)
        try validate(app: newApp, expectedVersion: expectedVersion)
        let staged = appURL.deletingLastPathComponent().appendingPathComponent(".Aster-update-\(UUID().uuidString).app", isDirectory: true)
        do {
            try run("/usr/bin/ditto", [newApp.path, staged.path])
            // The checks above stand in for Gatekeeper's first-launch prompt, as with other app updaters.
            _ = try? run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", staged.path])
            try validate(app: staged, expectedVersion: expectedVersion)
            _ = try FileManager.default.replaceItemAt(appURL, withItemAt: staged)
        } catch {
            try? FileManager.default.removeItem(at: staged)
            if (error as NSError).domain == NSCocoaErrorDomain, (error as NSError).code == NSFileWriteNoPermissionError {
                throw UpdateError("Aster doesn't have permission to replace itself in this folder.")
            }
            throw error
        }
    }

    nonisolated static func validate(app: URL, expectedVersion: SemanticVersion) throws {
        let info = NSDictionary(contentsOf: app.appendingPathComponent("Contents/Info.plist")) as? [String: Any] ?? [:]
        guard info["CFBundleIdentifier"] as? String == "app.aster.browser" else { throw UpdateError("The download doesn't contain Aster.") }
        guard (info["CFBundleShortVersionString"] as? String).flatMap(SemanticVersion.init) == expectedVersion else {
            throw UpdateError("The download contains a different version of Aster than expected.")
        }
        do {
            try run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app.path])
        } catch {
            throw UpdateError("The downloaded app's code signature is invalid.")
        }
    }

    nonisolated static func sha256(of file: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty { hasher.update(data: chunk) }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    @discardableResult
    nonisolated static func run(_ tool: String, _ arguments: [String]) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: tool)
        process.arguments = arguments
        let output = Pipe()
        process.standardOutput = output
        process.standardError = output
        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let text = String(decoding: data, as: UTF8.self)
        guard process.terminationStatus == 0 else {
            throw UpdateError("\((tool as NSString).lastPathComponent) failed: \(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(300))")
        }
        return text
    }

    /// Quits and reopens the (now updated) app once this process has exited.
    private func relaunch(_ appURL: URL) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", "while /bin/kill -0 \(ProcessInfo.processInfo.processIdentifier) 2>/dev/null; do /bin/sleep 0.2; done; /usr/bin/open \"$0\"", appURL.path]
        try? process.run()
        NSApp.terminate(nil)
    }

    // MARK: Progress window

    private var progressLabel: NSTextField?

    private func showProgress(_ text: String) {
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 340, height: 92), styleMask: [.titled], backing: .buffered, defer: false)
        panel.title = "Updating Aster"
        let label = NSTextField(labelWithString: text)
        let spinner = NSProgressIndicator()
        spinner.style = .bar
        spinner.isIndeterminate = true
        spinner.startAnimation(nil)
        let stack = NSStackView(views: [label, spinner])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.edgeInsets = NSEdgeInsets(top: 18, left: 20, bottom: 18, right: 20)
        spinner.widthAnchor.constraint(equalToConstant: 300).isActive = true
        panel.contentView = stack
        panel.center()
        panel.isReleasedWhenClosed = false
        panel.makeKeyAndOrderFront(nil)
        progressPanel = panel
        progressLabel = label
    }

    private func updateProgress(_ text: String) { progressLabel?.stringValue = text }

    private func hideProgress() {
        progressPanel?.close()
        progressPanel = nil
    }
}
