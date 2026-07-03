import SwiftUI
import AppKit
import Combine

@main
struct BattCalBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    var body: some Scene {
        // The status item, popover, and the poppable main window all live in the
        // AppDelegate (AppKit) so the popover anchors precisely under the menu bar item
        // and the window gets standard native chrome. This is a proper app (Dock icon +
        // cmd-tab) PLUS a menu bar item, like coconutBattery.
        Settings { EmptyView() }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let model = BattCalModel()
    private var statusItem: NSStatusItem!
    private let popover = NSPopover()
    private var mainWindow: NSWindow?
    private var cancellables = Set<AnyCancellable>()

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Proper app: Dock icon + cmd-tab, in addition to the menu bar item.
        NSApp.setActivationPolicy(.regular)

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.font = .monospacedDigitSystemFont(ofSize: 12, weight: .medium)
            button.imagePosition = .imageLeading
            button.target = self
            button.action = #selector(togglePopover)
        }

        popover.behavior = .transient
        popover.animates = true
        popover.contentViewController = NSHostingController(
            rootView: PopoverView(model: model, onPopOut: { [weak self] in self?.showMainWindow() })
        )

        // Keep the menu bar title in sync with the live model + chosen label style.
        model.$status.receive(on: RunLoop.main).sink { [weak self] _ in self?.updateButton() }.store(in: &cancellables)
        model.$reachable.receive(on: RunLoop.main).sink { [weak self] _ in self?.updateButton() }.store(in: &cancellables)
        NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)
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
        let raw = UserDefaults.standard.string(forKey: "menuLabelStyle") ?? LabelStyle.eta.rawValue
        let style = LabelStyle(rawValue: raw) ?? .eta
        // Always show BattCal's distinct cycle glyph so the item reads as BattCal, not a
        // stray number next to macOS's battery. iconOnly is glyph-only; every other style
        // adds a compact status (ETA/watts/mode), never a bare percent that duplicates macOS.
        button.image = NSImage(systemSymbolName: model.menuBarSymbol, accessibilityDescription: "BattCal")
        let text = (style == .iconOnly) ? nil : model.menuLabel(for: style)
        button.title = text.map { " \($0)" } ?? ""
    }

    // The poppable coconutBattery-style window. Built once and reused (never released),
    // so it reopens instantly from the popover button or the Dock icon.
    func showMainWindow() {
        if popover.isShown { popover.performClose(nil) }
        if mainWindow == nil {
            let hosting = NSHostingController(rootView: MainWindowView(model: model))
            let w = NSWindow(contentViewController: hosting)
            w.title = "BattCal"
            w.styleMask = [.titled, .closable, .miniaturizable, .resizable]
            w.setContentSize(NSSize(width: 360, height: 512))
            w.isReleasedWhenClosed = false
            w.center()
            mainWindow = w
        }
        NSApp.activate(ignoringOtherApps: true)
        mainWindow?.makeKeyAndOrderFront(nil)
    }

    @objc private func togglePopover() {
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
