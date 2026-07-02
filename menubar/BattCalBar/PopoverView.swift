import SwiftUI
import Charts
import ServiceManagement

struct PopoverView: View {
    @ObservedObject var model: BattCalModel
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
    @AppStorage("menuLabelStyle") private var labelStyleRaw = LabelStyle.eta.rawValue

    private var s: EngineStatus? { model.status }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header: big battery number + live state
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
                Spacer()
            }

            // 3h sparkline
            if !model.spark.isEmpty {
                Chart(model.spark) {
                    LineMark(x: .value("Time", $0.date), y: .value("%", $0.pct))
                        .lineStyle(StrokeStyle(lineWidth: 2))
                        .interpolationMethod(.monotone)
                    AreaMark(x: .value("Time", $0.date), y: .value("%", $0.pct))
                        .opacity(0.12)
                }
                .chartYScale(domain: 0...100)
                .chartXAxis(.hidden)
                .chartYAxis {
                    AxisMarks(values: [0, 50, 100]) {
                        AxisGridLine()
                        AxisValueLabel().font(.system(size: 8))
                    }
                }
                .frame(height: 56)
            }

            // Mode picker
            Picker("Mode", selection: Binding(
                get: { s?.mode ?? "longevity" },
                set: { model.setMode($0) }
            )) {
                Text("Longevity 10-90").tag("longevity")
                Text("Calibration 5-100").tag("calibration")
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .disabled(!model.reachable || !model.engineLoaded)

            // Stats grid
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 4) {
                GridRow {
                    stat("Power", s?.batteryW.map { String(format: "%+.1f W", $0) } ?? "--")
                    stat("Temp", s?.tempC.map { String(format: "%.1f °C", $0) } ?? "--")
                }
                GridRow {
                    stat("True health", s?.rawHealthPct.map { String(format: "%.1f%%", $0) } ?? "--")
                    stat("Apple says", s?.appleHealth ?? "--")
                }
            }
            .padding(.vertical, 2)

            Divider()

            // Primary actions
            if model.engineLoaded {
                if s?.paused == true {
                    actionButton("play.fill", "Resume cycling", .prominent) { model.resume() }
                } else {
                    actionButton("bolt.fill", "Charge full now (pause cycling)", .prominent) { model.pause() }
                }
                actionButton("power", "Turn cycling off (charge like normal)") { model.turnEngineOff() }
            } else {
                actionButton("play.circle.fill", "Turn cycling on", .prominent) { model.turnEngineOn() }
                Text("Engine is off: your Mac charges to 100% like a normal Mac.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            actionButton("chart.xyaxis.line", "Open dashboard", .prominent) { model.openDashboard() }

            Divider()

            HStack(spacing: 6) {
                Text("Menu bar shows").font(.caption).foregroundStyle(.secondary)
                Picker("", selection: $labelStyleRaw) {
                    ForEach(LabelStyle.allCases) { Text($0.title).tag($0.rawValue) }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .font(.caption)
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
        .padding(14)
        .frame(width: 320)
    }

    private var subline: String {
        var parts: [String] = []
        parts.append(s?.plugged == true ? "Plugged in · \(s?.adapterW ?? 0) W adapter" : "On battery")
        if let (mins, target) = model.minutesToTarget {
            let t = mins >= 60 ? "\(mins / 60)h \(mins % 60)m" : "\(mins)m"
            parts.append("~\(t) until \(target)% at current draw")
        }
        return parts.joined(separator: " · ")
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label.uppercased()).font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
            Text(value).font(.callout.weight(.semibold)).monospacedDigit()
        }
        .frame(minWidth: 120, alignment: .leading)
    }

    private enum Prominence { case normal, prominent }

    private func actionButton(_ icon: String, _ title: String, _ p: Prominence = .normal, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Image(systemName: icon).frame(width: 16)
                Text(title)
                Spacer()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .padding(.vertical, 3)
        .padding(.horizontal, 6)
        .background(p == .prominent ? Color.accentColor.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 6))
        .font(.callout)
    }
}
