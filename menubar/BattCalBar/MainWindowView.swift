import SwiftUI

// The standalone, resizable window (opened from the popover's pop-out button or by
// clicking the Dock icon). Tabbed like coconutBattery, with a wide Liquid Glass layout
// that shows everything at once - no scrolling or resizing needed.
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

// The main glance tab: a wide two-column dashboard that fits without scrolling.
struct ThisMacTab: View {
    @ObservedObject var model: BattCalModel
    private var s: EngineStatus? { model.status }

    var body: some View {
        ScrollView {
            GlassStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 12) {
                    header

                    if model.isDischarging || model.breakUntil != nil {
                        TimelineView(.periodic(from: .now, by: 1)) { ctx in
                            PowerBanner(model: model, now: ctx.date)
                        }
                    }

                    HStack(alignment: .top, spacing: 12) {
                        VStack(spacing: 12) {
                            GlassCard { meters }
                            GlassCard { actions }
                            GlassCard { modeCard }
                        }
                        VStack(spacing: 12) {
                            GlassCard { chartCard }
                            GlassCard { statGrid }
                        }
                    }

                    footer
                }
                .padding(16)
            }
        }
    }

    // MARK: hero header

    private var header: some View {
        HStack(spacing: 14) {
            chargeRing
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
        .padding(.horizontal, 2)
    }

    private var chargeRing: some View {
        ZStack {
            Circle().stroke(Color.primary.opacity(0.12), lineWidth: 6)
            Circle()
                .trim(from: 0, to: CGFloat(min(100, max(0, s?.pct ?? 0))) / 100)
                .stroke(model.stateColor, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text(s?.pct.map { "\($0)" } ?? "--")
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .monospacedDigit()
        }
        .frame(width: 68, height: 68)
    }

    // MARK: left column

    private var meters: some View {
        VStack(spacing: 11) {
            MeterBar(label: "Battery charge",
                     valueText: s?.pct.map { "\($0)%" } ?? "--",
                     fraction: Double(s?.pct ?? 0) / 100,
                     tint: model.stateColor)
            MeterBar(label: "Battery health (true)",
                     valueText: s?.rawHealthPct.map { String(format: "%.1f%%", $0) } ?? "--",
                     fraction: (s?.rawHealthPct ?? 0) / 100,
                     tint: (s?.rawHealthPct ?? 100) >= 80 ? .green : .orange,
                     marker: 0.80)
        }
    }

    private var actions: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "QUICK ACTIONS")
            GlassActionButton(title: "Charge to 100% now", icon: "bolt.fill", tint: .blue, enabled: model.reachable) { model.select(.normal) }
            GlassActionButton(title: "Deep calibrate now", icon: "gauge.with.needle", tint: .orange, enabled: model.reachable) { model.select(.calibration) }
            GlassActionButton(title: "Benchmark break (30 min)", icon: "speedometer", tint: .green, enabled: model.reachable) { model.benchmarkBreak(minutes: 30) }
        }
    }

    private var modeCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "MODE")
            ModeSelector(model: model)
        }
    }

    // MARK: right column

    private var chartCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "LAST 3 HOURS")
            if model.spark.isEmpty {
                Text("collecting telemetry...").font(.caption).foregroundStyle(.secondary).frame(height: 150)
            } else {
                LiveChart(spark: model.spark, height: 150)
            }
        }
    }

    private var statGrid: some View {
        Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 13) {
            GridRow {
                cell("battery.100percent", "Full charge", s?.rawMah.map { String(format: "%.0f mAh", $0) } ?? "--")
                cell("square.dashed", "Design", s?.designMah.map { String(format: "%.0f mAh", $0) } ?? "--")
            }
            GridRow {
                cell("arrow.triangle.2.circlepath", "Cycles", "\(s?.cycles ?? 0)" + (s?.designCycles.map { " / \($0)" } ?? ""))
                cell("thermometer.medium", "Temp", s?.tempC.map { String(format: "%.1f \u{00B0}C", $0) } ?? "--")
            }
            GridRow {
                cell("bolt.fill", "Power", s?.batteryW.map { String(format: "%+.1f W", $0) } ?? "--")
                cell("powerplug.fill", "Adapter", s?.plugged == true ? "\(s?.adapterW ?? 0) W" : "on battery")
            }
            GridRow {
                cell("heart.fill", "Apple health", s?.appleHealth ?? "--")
                cell("checkmark.seal.fill", "Condition", s?.condition ?? "--")
            }
        }
    }

    private func cell(_ icon: String, _ label: String, _ value: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 12)).foregroundStyle(.secondary).frame(width: 16)
            VStack(alignment: .leading, spacing: 1) {
                Text(label.uppercased()).font(.system(size: 8.5, weight: .semibold)).foregroundStyle(.secondary)
                Text(value).font(.system(.callout, design: .rounded).weight(.semibold)).monospacedDigit()
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: footer

    private var footer: some View {
        Button { model.openDashboard() } label: {
            HStack {
                Image(systemName: "chart.xyaxis.line")
                Text("Open web dashboard").fontWeight(.semibold)
                Spacer()
                Image(systemName: "arrow.up.forward").font(.caption)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 3)
            .contentShape(Rectangle())
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
