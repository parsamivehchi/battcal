import SwiftUI
import ServiceManagement

struct PopoverView: View {
    @ObservedObject var model: BattCalModel
    var onPopOut: () -> Void = {}
    var inWindow: Bool = false   // true when hosted in the standalone window (no pop-out button)
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
    @AppStorage("menuLabelStyle") private var labelStyleRaw = LabelStyle.eta.rawValue

    private var s: EngineStatus? { model.status }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header: big battery number + live state, with a pop-out-to-window button.
            HStack(alignment: .top) {
                HStack(alignment: .firstTextBaseline) {
                    Image(systemName: model.symbolName)
                        .font(.title2)
                        .foregroundStyle(model.stateColor)
                    Text(model.titleText)
                        .font(.system(size: 28, weight: .bold))
                        .monospacedDigit()
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 5) {
                            Circle().fill(model.stateColor).frame(width: 7, height: 7)
                            Text(model.stateLine).font(.callout.weight(.semibold))
                        }
                        Text(subline)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.leading, 2)
                }
                Spacer()
                if !inWindow {
                    Button(action: onPopOut) {
                        Image(systemName: "macwindow").font(.title3).foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .help("Open the BattCal window")
                }
            }

            // Throttle warning while draining, or a live countdown during a break.
            if model.isDischarging || model.breakUntil != nil {
                TimelineView(.periodic(from: .now, by: 1)) { ctx in
                    PowerBanner(model: model, now: ctx.date)
                }
            }

            if !model.spark.isEmpty { LiveChart(spark: model.spark) }

            // Mode selector
            Text("MODE").font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary).padding(.top, 2)
            ModeSelector(model: model)
            if !model.reachable {
                Text("BattCal server offline \u{2013} controls disabled").font(.caption).foregroundStyle(.secondary)
            }

            // Stats grid
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 4) {
                GridRow {
                    stat("Power", s?.batteryW.map { String(format: "%+.1f W", $0) } ?? "--")
                    stat("Temp", s?.tempC.map { String(format: "%.1f \u{00B0}C", $0) } ?? "--")
                }
                GridRow {
                    stat("True health", s?.rawHealthPct.map { String(format: "%.1f%%", $0) } ?? "--")
                    stat("Apple says", s?.appleHealth ?? "--")
                }
            }
            .padding(.vertical, 2)

            Divider()

            Button { model.openDashboard() } label: {
                HStack {
                    Image(systemName: "chart.xyaxis.line").frame(width: 16)
                    Text("Open dashboard").fontWeight(.semibold)
                    Spacer()
                    Image(systemName: "arrow.up.forward").font(.caption)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.vertical, 7).padding(.horizontal, 10)
            .background(Color.accentColor.opacity(0.9), in: RoundedRectangle(cornerRadius: 8))
            .foregroundStyle(.white)

            Divider()

            VStack(spacing: 8) {
                HStack(spacing: 6) {
                    Text("Menu bar shows").font(.caption).foregroundStyle(.secondary)
                    Picker("", selection: $labelStyleRaw) {
                        ForEach(LabelStyle.allCases) { Text($0.title).tag($0.rawValue) }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                    .font(.caption)
                    Spacer()
                }
                HStack {
                    Toggle("Launch at login", isOn: $launchAtLogin)
                        .toggleStyle(.checkbox)
                        .font(.caption)
                        .onChange(of: launchAtLogin) { _, on in
                            do {
                                if on { try SMAppService.mainApp.register() }
                                else { try SMAppService.mainApp.unregister() }
                            } catch {
                                launchAtLogin = SMAppService.mainApp.status == .enabled
                            }
                        }
                    Spacer()
                    Button("Quit") { NSApp.terminate(nil) }
                        .font(.caption)
                }
            }
        }
        .padding(14)
        .frame(width: 340)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var subline: String {
        var parts: [String] = []
        parts.append(s?.plugged == true ? "Plugged in \u{00B7} \(s?.adapterW ?? 0) W adapter" : "On battery")
        if let (mins, target) = model.minutesToTarget {
            let t = mins >= 60 ? "\(mins / 60)h \(mins % 60)m" : "\(mins)m"
            parts.append("~\(t) until \(target)% at current draw")
        }
        if model.engineLoaded, s?.paused != true, model.flow == .draining, s?.plugged == true {
            parts.append(s?.mode == "calibration" ? "charger LED pulses green" : "charger LED dark = BattCal draining")
        }
        return parts.joined(separator: " \u{00B7} ")
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label.uppercased()).font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
            Text(value).font(.callout.weight(.semibold)).monospacedDigit().foregroundStyle(.primary)
        }
        .frame(minWidth: 120, alignment: .leading)
    }
}
