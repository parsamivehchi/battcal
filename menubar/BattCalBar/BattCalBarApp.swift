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
            HStack(spacing: 3) {
                Image(systemName: model.symbolName)
                if let text = model.labelText(for: style) {
                    Text(text)
                        .font(.system(size: 11, weight: .medium))
                        .monospacedDigit()
                }
            }
        }
        .menuBarExtraStyle(.window)
    }
}
