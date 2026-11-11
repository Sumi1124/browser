// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
import AppKit

// Top-level code runs on the main thread; tell the compiler so it can call
// main-actor-isolated AppKit code. run() never returns, keeping the delegate alive.
MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    app.run()
}
