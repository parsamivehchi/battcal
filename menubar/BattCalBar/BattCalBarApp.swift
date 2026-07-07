import SwiftUI
import AppKit
import Combine

@main
struct BattCalBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    var body: some Scene {
        // The status item, popover, the poppable main window, AND the Settings window all live in
        // the AppDelegate (AppKit) so the popover anchors precisely under the menu bar item and
        // every window gets deterministic native chrome. This is a proper app (Dock icon +
        // cmd-tab) PLUS a menu bar item, like coconutBattery.
        //
        // The empty Settings scene only satisfies SwiftUI's one-scene requirement. The real
        // Settings window is AppDelegate.showSettings(): the showSettingsWindow: responder action
        // no longer resolves from an AppKit-hosted popover on macOS 26, so the app-menu item and
        // Cmd-comma are rerouted to the same AppKit window here (and belt-and-braces in the
        // delegate's menu retarget).
        Settings { EmptyView() }
            .commands {
                CommandGroup(replacing: .appSettings) {
                    Button("Settings\u{2026}") { appDelegate.showSettings() }
                        .keyboardShortcut(",", modifiers: .command)
                }
            }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let model = BattCalModel()
    let wifi = WiFiMonitor()
    private var statusItem: NSStatusItem!
    private let popover = NSPopover()
    private var mainWindow: NSWindow?
    private var settingsWindow: NSWindow?
    private var cancellables = Set<AnyCancellable>()

    func applicationDidFinishLaunching(_ notification: Notification) {
        // One-time migration that set the default menu bar style to Live (Watts + time). Only moved
        // the old dynamic defaults (eta/power/unset); an explicit percent/health/icon choice is preserved.
        let defaults = UserDefaults.standard
        if !defaults.bool(forKey: "didMigrateLiveV1") {
            let cur = defaults.string(forKey: "menuLabelStyle")
            if cur == nil || cur == "eta" || cur == "power" { defaults.set("live", forKey: "menuLabelStyle") }
            defaults.set(true, forKey: "didMigrateLiveV1")
        }
        // V2: the menu bar now defaults to the cool icon-only glyph (no redundant %). Flip anyone still
        // on a dynamic / percent / live default to iconOnly once; an explicit health / iconOnly pick stays.
        if !defaults.bool(forKey: "didMigrateIconV2") {
            let cur = defaults.string(forKey: "menuLabelStyle")
            if cur == nil || cur == "live" || cur == "eta" || cur == "power" || cur == "percent" {
                defaults.set("iconOnly", forKey: "menuLabelStyle")
            }
            defaults.set(true, forKey: "didMigrateIconV2")
        }
        // Proper app: Dock icon + cmd-tab, in addition to the menu bar item.
        NSApp.setActivationPolicy(.regular)

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.font = .monospacedDigitSystemFont(ofSize: 12, weight: .medium)
            button.imagePosition = .imageLeading
            button.target = self
            button.action = #selector(handleClick)
            // Left-click opens the popover; right-click (or control-click) cycles the label style.
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }

        popover.behavior = .transient
        popover.animates = true
        popover.contentViewController = NSHostingController(
            rootView: PopoverView(model: model, wifi: wifi,
                                  onPopOut: { [weak self] in self?.showMainWindow() },
                                  onOpenSettings: { [weak self] in self?.showSettings() })
        )

        // Belt-and-braces for Cmd-comma / the app-menu Settings item: some macOS releases keep the
        // Settings scene's auto-synthesized item instead of honoring CommandGroup(replacing:), so
        // after SwiftUI finishes building the main menu, retarget whatever item owns the comma key
        // equivalent to our window. Matching by key equivalent / legacy action (never the localized
        // title) keeps this locale-proof; retargeting an already-correct item is harmless.
        DispatchQueue.main.async { [weak self] in
            guard let self, let appMenu = NSApp.mainMenu?.items.first?.submenu else { return }
            if let item = appMenu.items.first(where: {
                ($0.keyEquivalent == "," && $0.keyEquivalentModifierMask == .command)
                    || $0.action == Selector(("showSettingsWindow:"))
            }) {
                item.target = self
                item.action = #selector(self.handleShowSettings)
            }
        }

        // Keep the menu bar title in sync with the live model + chosen label style.
        model.$status.receive(on: RunLoop.main).sink { [weak self] _ in self?.updateButton() }.store(in: &cancellables)
        model.$reachable.receive(on: RunLoop.main).sink { [weak self] _ in self?.updateButton() }.store(in: &cancellables)
        // Only react to the label-style default, not every UserDefaults write (the model persists
        // notif.cycles / notif.below80 each poll, which used to redraw the menu bar for nothing).
        NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)
            .map { _ in UserDefaults.standard.string(forKey: "menuLabelStyle") ?? LabelStyle.iconOnly.rawValue }
            .removeDuplicates()
            .receive(on: RunLoop.main).sink { [weak self] _ in self?.updateButton() }.store(in: &cancellables)
        updateButton()
    }

    // Clicking the Dock icon with no window open pops the main window.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { showMainWindow() }
        return true
    }

    private func updateButton() {
        guard let button = statusItem.button else { return }
        let raw = UserDefaults.standard.string(forKey: "menuLabelStyle") ?? LabelStyle.iconOnly.rawValue
        let style = LabelStyle(rawValue: raw) ?? .iconOnly
        // The menu bar shows ONE thing: the value alone when a value-style has a live reading
        // (its sign carries direction, so a leading glyph would be redundant), else the glyph
        // alone (icon-only, or any style while flat/idle).
        let value = (style == .iconOnly) ? nil : model.menuBarValue(for: style)
        let img = menuBarImage(symbol: model.menuBarSymbol(for: style), value: value)
        img.accessibilityDescription = model.menuBarAccessibility(for: style)
        button.image = img
        button.title = ""
    }

    // Render the menu bar item as EITHER the value text alone OR the glyph alone (never both, so a
    // signed reading like "-19.1W" never sits next to a redundant direction glyph). Template so the
    // menu bar owns the tint; sized to content so it scales to the bar height without clipping.
    private func menuBarImage(symbol: String, value: String?) -> NSImage {
        let padX: CGFloat = 2
        if let value {
            let font = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .semibold)
            let str = NSAttributedString(string: value, attributes: [.font: font, .foregroundColor: NSColor.black])
            let vs = str.size()
            let size = NSSize(width: max(vs.width + padX * 2, 8), height: max(vs.height, 8))
            let image = NSImage(size: size, flipped: false) { rect in
                str.draw(at: NSPoint(x: padX, y: rect.midY - vs.height / 2))
                return true
            }
            image.isTemplate = true
            return image
        }
        let conf = NSImage.SymbolConfiguration(pointSize: 15, weight: .semibold)
        let glyph = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)?.withSymbolConfiguration(conf)
        let gs = glyph?.size ?? NSSize(width: 15, height: 15)
        let size = NSSize(width: max(gs.width + padX * 2, 8), height: max(gs.height, 8))
        let image = NSImage(size: size, flipped: false) { rect in
            glyph?.draw(in: NSRect(x: rect.midX - gs.width / 2, y: rect.midY - gs.height / 2, width: gs.width, height: gs.height))
            return true
        }
        image.isTemplate = true
        return image
    }

    // The poppable coconutBattery-style window. Built once and reused (never released),
    // so it reopens instantly from the popover button or the Dock icon.
    func showMainWindow() {
        if popover.isShown { popover.performClose(nil) }
        let wasVisible = mainWindow?.isVisible ?? false
        if mainWindow == nil {
            // The window is simply the menu bar popover, made persistent. Same view, same
            // look; a translucent vibrant backing so it matches the popover material.
            let content = PopoverView(model: model, wifi: wifi,
                                      onOpenSettings: { [weak self] in self?.showSettings() },
                                      inWindow: true)
                .background(VisualEffectView().ignoresSafeArea())
            let hosting = NSHostingController(rootView: content)
            let w = NSWindow(contentViewController: hosting)
            w.title = "BattCal"
            // Translucent, unified title bar (traffic lights float over the vibrant content).
            w.styleMask = [.titled, .closable, .miniaturizable, .fullSizeContentView]
            w.titlebarAppearsTransparent = true
            w.titleVisibility = .hidden
            w.isMovableByWindowBackground = true
            w.isOpaque = false
            w.backgroundColor = .clear
            w.isReleasedWhenClosed = false
            hosting.view.layoutSubtreeIfNeeded()
            w.setContentSize(hosting.view.fittingSize)   // fit the popover exactly, no dead space
            positionNearStatusItem(w)
            mainWindow = w
        } else if !wasVisible, let w = mainWindow {
            // Reopening from closed: re-anchor near the click, which may be on a different screen.
            positionNearStatusItem(w)
        }
        NSApp.activate(ignoringOtherApps: true)
        mainWindow?.makeKeyAndOrderFront(nil)
    }

    // The Settings window. Like the main window it is AppKit-owned, built once and reused (never
    // released), so every entry point (popover gear, both window footers, the app menu, Cmd-comma)
    // opens it deterministically - no reliance on the fragile showSettingsWindow: responder action.
    func showSettings() {
        if popover.isShown { popover.performClose(nil) }
        if settingsWindow == nil {
            let hosting = NSHostingController(rootView: SettingsView(model: model, wifi: wifi))
            let w = NSWindow(contentViewController: hosting)
            w.title = "BattCal Settings"
            // Standard opaque settings chrome (unlike the vibrant popover window): fixed size.
            w.styleMask = [.titled, .closable, .miniaturizable]
            w.isReleasedWhenClosed = false   // close hides; the SwiftUI tree + pane selection survive reopen
            hosting.view.layoutSubtreeIfNeeded()
            w.setContentSize(hosting.view.fittingSize)
            w.center()
            settingsWindow = w
        }
        NSApp.activate(ignoringOtherApps: true)
        settingsWindow?.makeKeyAndOrderFront(nil)
    }

    @objc private func handleShowSettings() { showSettings() }

    // Open the window near where the user clicked (the menu bar item / dock), pinned just
    // below the menu bar on the screen that click is on.
    private func positionNearStatusItem(_ w: NSWindow) {
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first(where: { $0.frame.contains(mouse) }) ?? NSScreen.main
        guard let vis = screen?.visibleFrame else { w.center(); return }
        let x = min(max(vis.minX + 12, mouse.x - w.frame.width / 2), vis.maxX - w.frame.width - 12)
        let y = vis.maxY - w.frame.height - 8
        w.setFrameOrigin(NSPoint(x: x, y: y))
    }

    // The status-item button fires on both mouse-up events (see sendAction above): left-click opens
    // the popover, right-click (or control-click) cycles the menu bar style.
    @objc private func handleClick() {
        let ev = NSApp.currentEvent
        let secondary = ev?.type == .rightMouseUp || (ev?.modifierFlags.contains(.control) ?? false)
        if secondary { cycleStyle() } else { togglePopover() }
    }

    // Advance the menu bar to the next label style (wrapping) and persist it; a brief tooltip names
    // the style so a cycle is legible. The pick sticks across restarts.
    private func cycleStyle() {
        let all = LabelStyle.allCases
        let raw = UserDefaults.standard.string(forKey: "menuLabelStyle") ?? LabelStyle.iconOnly.rawValue
        let cur = LabelStyle(rawValue: raw) ?? .iconOnly
        let idx = all.firstIndex(of: cur) ?? -1
        let next = all[(idx + 1) % all.count]
        UserDefaults.standard.set(next.rawValue, forKey: "menuLabelStyle")
        statusItem.button?.toolTip = "BattCal: \(next.title)"
        updateButton()
    }

    private func togglePopover() {
        guard let button = statusItem.button else { return }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            NSApp.activate(ignoringOtherApps: true)
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .maxY)
            popover.contentViewController?.view.window?.makeKey()
        }
    }
}
