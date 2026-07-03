import SwiftUI

// The standalone window: a native macOS sidebar app (NavigationSplitView) with native
// Form detail panes - the System Settings shell, which adapts to iPad/iPhone too.
struct MainWindowView: View {
    @ObservedObject var model: BattCalModel
    @State private var pane: Pane = .thisMac

    enum Pane: String, CaseIterable, Identifiable {
        case thisMac = "This Mac", history = "History", genius = "Genius Bar"
        var id: String { rawValue }
        var icon: String {
            switch self {
            case .thisMac: return "laptopcomputer"
            case .history: return "chart.xyaxis.line"
            case .genius: return "cross.case.fill"
            }
        }
    }

    var body: some View {
        GeometryReader { geo in
            // Wide window -> native sidebar (System Settings). Narrow -> top segmented tabs.
            if geo.size.width >= 620 {
                NavigationSplitView {
                    List(selection: sidebarSelection) {
                        ForEach(Pane.allCases) { p in
                            Label(p.rawValue, systemImage: p.icon).tag(p)
                        }
                    }
                    .navigationSplitViewColumnWidth(min: 158, ideal: 172, max: 220)
                } detail: {
                    detail
                }
                .navigationSplitViewStyle(.balanced)
            } else {
                VStack(spacing: 0) {
                    Picker("Section", selection: $pane) {
                        ForEach(Pane.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .padding(.horizontal, 12).padding(.top, 8).padding(.bottom, 6)
                    Divider()
                    detail
                }
            }
        }
        .frame(minWidth: 380, minHeight: 540)
        .background(VisualEffectView().ignoresSafeArea())
    }

    @ViewBuilder private var detail: some View {
        switch pane {
        case .thisMac: ThisMacPane(model: model)
        case .history: HistoryPane(model: model)
        case .genius:  GeniusBarPane(model: model)
        }
    }

    private var sidebarSelection: Binding<Pane?> {
        Binding(get: { pane }, set: { if let v = $0 { pane = v } })
    }
}

// This Mac: a native grouped Form, like the Battery pane in System Settings.
struct ThisMacPane: View {
    @ObservedObject var model: BattCalModel
    private var s: EngineStatus? { model.status }

    var body: some View {
        Form {
            Section {
                VStack(spacing: 10) {
                    Gauge(value: Double(min(100, max(0, s?.pct ?? 0))), in: 0...100) {
                    } currentValueLabel: {
                        Text("\(s?.pct ?? 0)").font(.system(.title, design: .rounded).weight(.bold)).monospacedDigit()
                    }
                    .gaugeStyle(.accessoryCircularCapacity)
                    .tint(model.stateColor)
                    .scaleEffect(2.0)
                    .frame(width: 108, height: 108)
                    .padding(.top, 6)

                    VStack(spacing: 3) {
                        Text(model.stateLine).font(.title3.weight(.semibold))
                        Text(subline).font(.callout).foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
            }

            if model.isDischarging || model.breakUntil != nil {
                throttleSection
            }

            Section("Battery") {
                LabeledContent("Charge", value: s?.pct.map { "\($0)%" } ?? "--")
                LabeledContent("True health", value: s?.rawHealthPct.map { String(format: "%.1f%%", $0) } ?? "--")
                LabeledContent("Full charge", value: s?.rawMah.map { String(format: "%.0f mAh", $0) } ?? "--")
                LabeledContent("Design capacity", value: s?.designMah.map { String(format: "%.0f mAh", $0) } ?? "--")
                LabeledContent("Cycle count", value: "\(s?.cycles ?? 0)" + (s?.designCycles.map { " / \($0)" } ?? ""))
                LabeledContent("Temperature", value: s?.tempC.map { String(format: "%.1f \u{00B0}C", $0) } ?? "--")
            }

            Section("Power") {
                LabeledContent("Power flow", value: s?.batteryW.map { String(format: "%+.1f W", $0) } ?? "--")
                LabeledContent("Adapter", value: s?.plugged == true ? "\(s?.adapterW ?? 0) W" : "on battery")
                LabeledContent("Apple health", value: s?.appleHealth ?? "--")
                LabeledContent("Condition", value: s?.condition ?? "--")
            }

            if !model.spark.isEmpty {
                Section("Last 3 Hours") {
                    LiveChart(spark: model.spark, height: 150)
                        .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
                }
            }

            Section("Cycling Mode") {
                Picker("Mode", selection: modeBinding) {
                    Text("Longevity - cycle 10-90%").tag(BattCalModel.ActiveMode.longevity)
                    Text("Calibration - 5-100% passes").tag(BattCalModel.ActiveMode.calibration)
                    Text("Normal charging").tag(BattCalModel.ActiveMode.normal)
                }
                .pickerStyle(.inline)
                .labelsHidden()
                .disabled(!model.reachable)
            }

            Section("Quick Actions") {
                Button { model.select(.normal) } label: { Label("Charge to 100% now", systemImage: "bolt.fill") }
                Button { model.select(.calibration) } label: { Label("Deep calibrate now", systemImage: "gauge.with.needle") }
                Button { model.benchmarkBreak(minutes: 30) } label: { Label("Benchmark break (30 min)", systemImage: "speedometer") }
            }
            .disabled(!model.reachable)

            Section {
                Button { model.openDashboard() } label: { Label("Open web dashboard", systemImage: "safari") }
            }
        }
        .formStyle(.grouped)
    }

    private var throttleSection: some View {
        Section {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 2) {
                    Text("CPU is power-throttled").font(.subheadline.weight(.semibold))
                    Text("Draining on battery, so heavy compute scores lower. Take a break to run at full speed.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            Button { model.benchmarkBreak(minutes: 30) } label: { Label("Benchmark break (30 min)", systemImage: "speedometer") }
        }
    }

    private var modeBinding: Binding<BattCalModel.ActiveMode> {
        Binding(get: { model.activeMode }, set: { model.select($0) })
    }

    private var subline: String {
        var parts: [String] = []
        parts.append(s?.plugged == true ? "Plugged in \u{00B7} \(s?.adapterW ?? 0) W adapter" : "On battery")
        if let (mins, target) = model.minutesToTarget {
            let t = mins >= 60 ? "\(mins / 60)h \(mins % 60)m" : "\(mins)m"
            parts.append("~\(t) to \(target)%")
        }
        return parts.joined(separator: "  \u{00B7}  ")
    }
}
