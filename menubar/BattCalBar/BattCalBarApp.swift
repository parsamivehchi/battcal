import SwiftUI

@main
struct BattCalBarApp: App {
    @StateObject private var model = BattCalModel()
    @AppStorage("menuLabelStyle") private var labelStyleRaw = LabelStyle.eta.rawValue

    var body: some Scene {
        MenuBarExtra {
            PopoverView(model: model)
        } label: {
            let style = LabelStyle(rawValue: labelStyleRaw) ?? .eta
            // No battery glyph for text styles: macOS already shows the battery
            // icon, so BattCal's item is just its own text ("9m→90%").
            if let text = model.menuLabel(for: style) {
                Text(text)
                    .font(.system(size: 11, weight: .medium))
                    .monospacedDigit()
            } else {
                Image(systemName: model.symbolName)
            }
        }
        .menuBarExtraStyle(.window)
    }
}
