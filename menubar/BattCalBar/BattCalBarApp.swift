import SwiftUI
import AppKit
import Combine

@main
struct BattCalBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    var body: some Scene {
        // Menu-bar-only app (LSUIElement); no window. The status item + popover
        // live in the AppDelegate so the popover anchors precisely under the item.
        Settings { EmptyView() }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let model = BattCalModel()
    private var statusItem: NSStatusItem!
    private let popover = NSPopover()
    private var cancellables = Set<AnyCancellable>()

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.font = .monospacedDigitSystemFont(ofSize: 12, weight: .medium)
            button.imagePosition = .imageLeading
            button.target = self
            button.action = #selector(togglePopover)
        }

        popover.behavior = .transient
        popover.animates = true
        popover.contentViewController = NSHostingController(rootView: PopoverView(model: model))

        // Keep the menu bar title in sync with the live model + chosen label style.
        model.$status.receive(on: RunLoop.main).sink { [weak self] _ in self?.updateButton() }.store(in: &cancellables)
        model.$reachable.receive(on: RunLoop.main).sink { [weak self] _ in self?.updateButton() }.store(in: &cancellables)
        NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)
            .receive(on: RunLoop.main).sink { [weak self] _ in self?.updateButton() }.store(in: &cancellables)
        updateButton()
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
