import SwiftUI

// The standalone, resizable window (opened from the popover's pop-out button or by
// clicking the Dock icon). Tabbed, translucent, built from native SwiftUI components
// (Gauge / GroupBox / LabeledContent / glass buttons) so it reads as a first-party app.
struct MainWindowView: View {
    @ObservedObject var model: BattCalModel
    @State private var tab = 0

    var body: some View {
        TabView(selection: $tab) {
            ThisMacTab(model: model)
                .tabItem { Label("This Mac", systemImage: "laptopcomputer") }.tag(0)
            HistoryTab(model: model)
                .tabItem { Label("History", systemImage: "chart.xyaxis.line") }.tag(1)
            GeniusBarTab(model: model)
                .tabItem { Label("Genius Bar", systemImage: "cross.case.fill") }.tag(2)
        }
        .frame(minWidth: 560, minHeight: 460)
        .background(VisualEffectView().ignoresSafeArea())
    }
}

// The main glance tab: a wide two-column dashboard of native components.
struct ThisMacTab: View {
    @ObservedObject var model: BattCalModel
    private var s: EngineStatus? { model.status }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header

                if model.isDischarging || model.breakUntil != nil {
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in
                        PowerBanner(model: model, now: ctx.date)
                    }
                }

                HStack(alignment: .top, spacing: 14) {
                    VStack(spacing: 14) {
                        GroupBox { meters }
                        GroupBox(label: sectionLabel("Quick Actions")) { actions.padding(.top, 4) }
                        GroupBox(label: sectionLabel("Mode")) { ModeSelector(model: model).padding(.top, 4) }
                    }
                    VStack(spacing: 14) {
                        GroupBox(label: sectionLabel("Last 3 Hours")) { chart.padding(.top, 4) }
                        GroupBox(label: sectionLabel("Battery")) { statList.padding(.top, 4) }
                    }
                }

                footer
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func sectionLabel(_ t: String) -> some View {
        Text(t).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
    }

    // MARK: hero header - native circular Gauge

    private var header: some View {
        HStack(spacing: 16) {
            Gauge(value: Double(min(100, max(0, s?.pct ?? 0))), in: 0...100) {
            } currentValueLabel: {
                Text("\(s?.pct ?? 0)").font(.system(.title2, design: .rounded).weight(.bold)).monospacedDigit()
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .tint(model.stateColor)
            .scaleEffect(1.6)
            .frame(width: 76, height: 76)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Circle().fill(model.stateColor).frame(width: 9, height: 9)
                    Text(model.stateLine).font(.title2.weight(.bold))
                }
                Text(subline).font(.callout).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
        }
        .padding(.horizontal, 4)
    }

    // MARK: left column

    private var meters: some View {
        VStack(spacing: 12) {
            Gauge(value: Double(min(100, max(0, s?.pct ?? 0))), in: 0...100) {
                Text("Charge")
            } currentValueLabel: {
                Text("\(s?.pct ?? 0)%").monospacedDigit()
            }
            .gaugeStyle(.accessoryLinearCapacity)
            .tint(model.stateColor)

            Gauge(value: min(100, max(0, s?.rawHealthPct ?? 0)), in: 0...100) {
                Text("Health")
            } currentValueLabel: {
                Text(s?.rawHealthPct.map { String(format: "%.1f%%", $0) } ?? "--").monospacedDigit()
            }
            .gaugeStyle(.accessoryLinearCapacity)
            .tint((s?.rawHealthPct ?? 100) >= 80 ? .green : .orange)
        }
        .padding(.vertical, 2)
    }

    private var actions: some View {
        VStack(spacing: 8) {
            actionButton("Charge to 100% now", "bolt.fill", .blue) { model.select(.normal) }
            actionButton("Deep calibrate now", "gauge.with.needle", .orange) { model.select(.calibration) }
            actionButton("Benchmark break", "speedometer", .green) { model.benchmarkBreak(minutes: 30) }
        }
    }

    private func actionButton(_ title: String, _ icon: String, _ tint: Color, _ run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Label(title, systemImage: icon).frame(maxWidth: .infinity, alignment: .leading)
        }
        .glassButtonStyle(tint: tint)
        .controlSize(.large)
        .disabled(!model.reachable)
    }

    // MARK: right column

    private var chart: some View {
        Group {
            if model.spark.isEmpty {
                Text("collecting telemetry...").font(.caption).foregroundStyle(.secondary).frame(height: 150)
            } else {
                LiveChart(spark: model.spark, height: 150)
            }
        }
    }

    private var statList: some View {
        Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 10) {
            GridRow {
                LabeledContent("Full charge", value: s?.rawMah.map { String(format: "%.0f mAh", $0) } ?? "--")
                LabeledContent("Design", value: s?.designMah.map { String(format: "%.0f mAh", $0) } ?? "--")
            }
            GridRow {
                LabeledContent("Cycles", value: "\(s?.cycles ?? 0)" + (s?.designCycles.map { " / \($0)" } ?? ""))
                LabeledContent("Temp", value: s?.tempC.map { String(format: "%.1f \u{00B0}C", $0) } ?? "--")
            }
            GridRow {
                LabeledContent("Power", value: s?.batteryW.map { String(format: "%+.1f W", $0) } ?? "--")
                LabeledContent("Adapter", value: s?.plugged == true ? "\(s?.adapterW ?? 0) W" : "battery")
            }
            GridRow {
                LabeledContent("Apple health", value: s?.appleHealth ?? "--")
                LabeledContent("Condition", value: s?.condition ?? "--")
            }
        }
        .labeledContentStyle(.stat)
        .padding(.vertical, 2)
    }

    // MARK: footer

    private var footer: some View {
        Button { model.openDashboard() } label: {
            Label("Open web dashboard", systemImage: "safari").frame(maxWidth: .infinity)
        }
        .glassButtonStyle(prominent: true, tint: .accentColor)
        .controlSize(.large)
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

// Compact vertical LabeledContent (label above value) for dense stat grids.
struct StatLabeledContentStyle: LabeledContentStyle {
    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            configuration.label
                .font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary)
            configuration.content
                .font(.system(.callout, design: .rounded).weight(.semibold)).monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
extension LabeledContentStyle where Self == StatLabeledContentStyle {
    static var stat: StatLabeledContentStyle { StatLabeledContentStyle() }
}
