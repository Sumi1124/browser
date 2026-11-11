// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
import AppKit

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
