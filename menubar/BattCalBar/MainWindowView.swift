import SwiftUI

// The standalone, resizable window (opened from the popover's pop-out button or by
// clicking the Dock icon). A richer coconutBattery-style read-out over the same live
// BattCalModel that drives the menu bar popover.
struct MainWindowView: View {
    @ObservedObject var model: BattCalModel
    private var s: EngineStatus? { model.status }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header

                if model.isDischarging || model.breakUntil != nil {
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in
                        PowerBanner(model: model, now: ctx.date)
                    }
                }

                meters

                if !model.spark.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("LAST 3 HOURS").font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary)
                        LiveChart(spark: model.spark, height: 150)
                    }
                }

                details

                VStack(alignment: .leading, spacing: 6) {
                    Text("MODE").font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary)
                    ModeSelector(model: model)
                }
                if !model.reachable {
                    Text("BattCal server offline \u{2013} controls disabled").font(.caption).foregroundStyle(.secondary)
                }

                footer
            }
            .padding(22)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minWidth: 400, minHeight: 560)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 14) {
            Image(systemName: model.symbolName).font(.system(size: 34)).foregroundStyle(model.stateColor)
            Text(model.titleText).font(.system(size: 44, weight: .bold)).monospacedDigit()
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Circle().fill(model.stateColor).frame(width: 9, height: 9)
                    Text(model.stateLine).font(.title3.weight(.semibold))
                }
                Text(subline).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
        }
    }

    private var meters: some View {
        VStack(spacing: 14) {
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

    private var details: some View {
        VStack(spacing: 0) {
            detail("Full charge", s?.rawMah.map { String(format: "%.0f mAh", $0) } ?? "--")
            detail("Design capacity", s?.designMah.map { String(format: "%.0f mAh", $0) } ?? "--")
            detail("Cycle count", "\(s?.cycles ?? 0)" + (s?.designCycles.map { " / \($0)" } ?? ""))
            detail("Temperature", s?.tempC.map { String(format: "%.1f \u{00B0}C", $0) } ?? "--")
            detail("Power flow", s?.batteryW.map { String(format: "%+.1f W", $0) } ?? "--")
            detail("Adapter", s?.plugged == true ? "\(s?.adapterW ?? 0) W" : "on battery")
            detail("Apple health (smoothed)", s?.appleHealth ?? "--")
            detail("Condition", s?.condition ?? "--")
        }
    }

    private func detail(_ label: String, _ value: String) -> some View {
        VStack(spacing: 0) {
            HStack {
                Text(label).font(.subheadline).foregroundStyle(.secondary)
                Spacer()
                Text(value).font(.subheadline.weight(.semibold)).monospacedDigit()
            }
            .padding(.vertical, 7)
            Divider()
        }
    }

    private var footer: some View {
        HStack {
            Button { model.openDashboard() } label: {
                Label("Open web dashboard", systemImage: "chart.xyaxis.line")
            }
            Spacer()
            Button("Quit BattCal") { NSApp.terminate(nil) }
        }
        .padding(.top, 4)
    }

    private var subline: String {
        var parts: [String] = []
        parts.append(s?.plugged == true ? "Plugged in \u{00B7} \(s?.adapterW ?? 0) W adapter" : "On battery")
        if let (mins, target) = model.minutesToTarget {
            let t = mins >= 60 ? "\(mins / 60)h \(mins % 60)m" : "\(mins)m"
            parts.append("~\(t) to \(target)%")
        }
        return parts.joined(separator: "   \u{00B7}   ")
    }
}
