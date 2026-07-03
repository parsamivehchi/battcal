import SwiftUI

// The standalone, resizable window (opened from the popover's pop-out button or by
// clicking the Dock icon). A dense coconutBattery-style read-out over the same live
// BattCalModel that drives the menu bar popover.
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

                VStack(spacing: 8) {
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

                if !model.spark.isEmpty { LiveChart(spark: model.spark, height: 96) }

                statGrid

                VStack(alignment: .leading, spacing: 5) {
                    Text("MODE").font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary)
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
        HStack(alignment: .center, spacing: 11) {
            Image(systemName: model.symbolName).font(.system(size: 26)).foregroundStyle(model.stateColor)
            Text(model.titleText).font(.system(size: 32, weight: .bold)).monospacedDigit()
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    Circle().fill(model.stateColor).frame(width: 8, height: 8)
                    Text(model.stateLine).font(.headline)
                }
                Text(subline).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
        }
    }

    private var statGrid: some View {
        Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 9) {
            GridRow {
                cell("Full charge", s?.rawMah.map { String(format: "%.0f mAh", $0) } ?? "--")
                cell("Design capacity", s?.designMah.map { String(format: "%.0f mAh", $0) } ?? "--")
            }
            GridRow {
                cell("Cycle count", "\(s?.cycles ?? 0)" + (s?.designCycles.map { " / \($0)" } ?? ""))
                cell("Temperature", s?.tempC.map { String(format: "%.1f \u{00B0}C", $0) } ?? "--")
            }
            GridRow {
                cell("Power flow", s?.batteryW.map { String(format: "%+.1f W", $0) } ?? "--")
                cell("Adapter", s?.plugged == true ? "\(s?.adapterW ?? 0) W" : "on battery")
            }
            GridRow {
                cell("Apple health", s?.appleHealth ?? "--")
                cell("Condition", s?.condition ?? "--")
            }
        }
    }

    private func cell(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label.uppercased()).font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
            Text(value).font(.callout.weight(.semibold)).monospacedDigit()
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
        .padding(.vertical, 7).padding(.horizontal, 10)
        .background(Color.accentColor.opacity(0.9), in: RoundedRectangle(cornerRadius: 8))
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
