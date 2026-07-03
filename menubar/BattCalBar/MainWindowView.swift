import SwiftUI

// The standalone, resizable window (opened from the popover's pop-out button or by
// clicking the Dock icon). A polished, dense coconutBattery-style read-out over the
// same live BattCalModel that drives the menu bar popover.
struct MainWindowView: View {
    @ObservedObject var model: BattCalModel
    private var s: EngineStatus? { model.status }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                header

                if model.isDischarging || model.breakUntil != nil {
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in
                        PowerBanner(model: model, now: ctx.date)
                    }
                }

                Card {
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

                if !model.spark.isEmpty {
                    Card {
                        VStack(alignment: .leading, spacing: 8) {
                            SectionLabel(text: "LAST 3 HOURS")
                            LiveChart(spark: model.spark, height: 92)
                        }
                    }
                }

                Card { statGrid }

                VStack(alignment: .leading, spacing: 6) {
                    SectionLabel(text: "MODE")
                    ModeSelector(model: model)
                }
                if !model.reachable {
                    Text("BattCal server offline \u{2013} controls disabled").font(.caption).foregroundStyle(.secondary)
                }

                footer
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minWidth: 340, minHeight: 420)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var header: some View {
        HStack(spacing: 14) {
            chargeRing
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Circle().fill(model.stateColor).frame(width: 8, height: 8)
                    Text(model.stateLine).font(.title3.weight(.semibold))
                }
                Text(subline).font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
        }
        .padding(.horizontal, 2)
    }

    private var chargeRing: some View {
        ZStack {
            Circle().stroke(Color.primary.opacity(0.12), lineWidth: 5)
            Circle()
                .trim(from: 0, to: CGFloat(min(100, max(0, s?.pct ?? 0))) / 100)
                .stroke(model.stateColor, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text(s?.pct.map { "\($0)" } ?? "--")
                .font(.system(size: 19, weight: .bold, design: .rounded))
                .monospacedDigit()
        }
        .frame(width: 60, height: 60)
    }

    private var statGrid: some View {
        Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 12) {
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

    private var footer: some View {
        Button { model.openDashboard() } label: {
            HStack {
                Image(systemName: "chart.xyaxis.line").frame(width: 16)
                Text("Open web dashboard").fontWeight(.semibold)
                Spacer()
                Image(systemName: "arrow.up.forward").font(.caption)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.vertical, 8).padding(.horizontal, 12)
        .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .foregroundStyle(.white)
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
