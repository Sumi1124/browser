// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
import AppKit
import AsterKit
import CoreServices
import WebKit

/// Saves downloads to ~/Downloads with safe, non-clobbering names and marks
/// them as downloaded from the internet, so Gatekeeper checks them before
/// they are opened.
@MainActor
final class DownloadManager: NSObject, WKDownloadDelegate {
    static let shared = DownloadManager()
    private var destinations: [ObjectIdentifier: URL] = [:]
    private var sources: [ObjectIdentifier: URL] = [:]

    func track(_ download: WKDownload) {
        download.delegate = self
        if let url = download.originalRequest?.url { sources[ObjectIdentifier(download)] = url }
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping @MainActor @Sendable (URL?) -> Void) {
        let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Downloads")
        let destination = FileNames.unique(FileNames.sanitize(suggestedFilename), in: folder)
        destinations[ObjectIdentifier(download)] = destination
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        let key = ObjectIdentifier(download)
        guard var destination = destinations.removeValue(forKey: key) else { return }
        let source = sources.removeValue(forKey: key)
        var values = URLResourceValues()
        var quarantine: [String: Any] = [
            kLSQuarantineAgentNameKey as String: "Aster",
            kLSQuarantineTypeKey as String: kLSQuarantineTypeWebDownload as String,
        ]
        if let source { quarantine[kLSQuarantineDataURLKey as String] = source }
        values.quarantineProperties = quarantine
        try? destination.setResourceValues(values)
        // Bounces the Downloads stack in the Dock.
        DistributedNotificationCenter.default().post(name: Notification.Name("com.apple.DownloadFileFinished"), object: destination.path)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let key = ObjectIdentifier(download)
        destinations.removeValue(forKey: key)
        sources.removeValue(forKey: key)
        if (error as NSError).code == NSURLErrorCancelled { return }
        let alert = NSAlert()
        alert.messageText = "Download failed"
        alert.informativeText = error.localizedDescription
        if let window = NSApp.keyWindow { alert.beginSheetModal(for: window, completionHandler: nil) } else { alert.runModal() }
    }
}
