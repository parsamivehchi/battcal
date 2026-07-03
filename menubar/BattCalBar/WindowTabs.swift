import SwiftUI
import Charts

struct HealthPoint: Identifiable {
    let date: Date
    let health: Double
    var id: Date { date }
}

// History: true-health-per-cycle trend + impact-since-BattCal-started, as a native Form.
struct HistoryPane: View {
    @ObservedObject var model: BattCalModel
    private var design: Double { model.status?.designMah ?? 6075 }
    private var points: [HealthPoint] {
        model.cycles.compactMap { row in
            guard let raw = row.raw_mAh, row.day > .distantPast else { return nil }
            return HealthPoint(date: row.day, health: raw / design * 100)
        }
    }

    var body: some View {
        Form {
            Section("True Health Per Cycle") {
                if points.count < 2 {
                    Text("Not enough cycles logged yet. Health snapshots accumulate as BattCal completes 10-90 passes.")
                        .font(.callout).foregroundStyle(.secondary)
                } else {
                    chart.listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
                }
            }
            Section("Impact Since BattCal Started") {
                LabeledContent("Cycle count", value: "\(model.status?.cycles ?? 0)" + (model.status?.designCycles.map { " / \($0)" } ?? ""))
                LabeledContent("Cycles per day", value: pace)
                LabeledContent("True health now", value: model.status?.rawHealthPct.map { String(format: "%.1f%%", $0) } ?? "--")
                LabeledContent("Change since start", value: change)
            }
            Section {
                Button { model.openDashboard() } label: { Label("Open web dashboard", systemImage: "safari") }
            }
        }
        .formStyle(.grouped)
    }

    private var chart: some View {
        Chart {
            ForEach(points) { p in
                LineMark(x: .value("Date", p.date), y: .value("Health", p.health))
                    .interpolationMethod(.monotone).foregroundStyle(Color.accentColor)
                PointMark(x: .value("Date", p.date), y: .value("Health", p.health))
                    .foregroundStyle(Color.accentColor).symbolSize(26)
            }
            RuleMark(y: .value("AppleCare", 80))
                .foregroundStyle(.red.opacity(0.6)).lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                .annotation(position: .top, alignment: .leading) {
                    Text("80% AppleCare").font(.system(size: 8)).foregroundStyle(.red)
                }
        }
        .chartYScale(domain: 76...92)
        .frame(height: 180)
    }

    private var change: String {
        guard let f = points.first, let l = points.last else { return "--" }
        return String(format: "%+.1f pp", l.health - f.health)
    }
    private var pace: String {
        guard let f = model.cycles.first, let l = model.cycles.last,
              let fc = f.cycle_count, let lc = l.cycle_count,
              f.day > .distantPast, l.day > .distantPast else { return "--" }
        let days = l.day.timeIntervalSince(f.day) / 86400
        guard days > 0.05 else { return "--" }
        return String(format: "%.1f/day", (lc - fc) / days)
    }
}

// Genius Bar: honest AppleCare evidence + a one-tap pre-appointment cycle, as a native Form.
struct GeniusBarPane: View {
    @ObservedObject var model: BattCalModel
    private var ev: Evidence? { model.evidence }
    private var symptoms: Bool { ev?.symptomsFound == true }
    private var prepActive: Bool { model.status?.prep?.active == true }

    var body: some View {
        Form {
            Section {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: symptoms ? "exclamationmark.triangle.fill" : "checkmark.seal.fill")
                        .foregroundStyle(symptoms ? .orange : .green).font(.title3)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(symptoms ? "Behavioral symptoms found" : "No hardware symptoms found")
                            .font(.subheadline.weight(.semibold))
                        Text("Apple decides on the macOS Maximum Capacity number, not the raw gauge. Honest evidence only, never fabricated.")
                            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            Section("Honest Evidence") {
                if ev == nil {
                    Text("Computing from telemetry...").font(.callout).foregroundStyle(.secondary)
                } else {
                    LabeledContent("macOS capacity", value: ev?.macos?.capacity ?? "--")
                    LabeledContent("Condition", value: ev?.macos?.condition ?? "--")
                    LabeledContent("Estimated runtime", value: ev?.runtime?.hours.map { String(format: "%.1f h", $0) } ?? "n/a")
                    LabeledContent("Internal resistance", value: ev?.resistanceMohm.map { String(format: "%.0f mOhm", $0) } ?? "--")
                    LabeledContent("Unexpected shutdowns", value: "\(ev?.shutdowns?.count ?? 0)")
                    LabeledContent("Projected at design cycles", value: ev?.projection?.projectedAtDesign.map { String(format: "%.0f%%", $0) } ?? "--")
                }
            }
            Section {
                if prepActive {
                    Button(role: .destructive) { model.endPrep() } label: { Label("End pre-appointment prep", systemImage: "stop.circle.fill") }
                } else {
                    Button { model.prep() } label: { Label("Run pre-appointment cycle", systemImage: "cross.case.fill") }
                }
            }
            .disabled(!model.reachable)
            Section {
                Button { model.openDashboard() } label: { Label("Open web dashboard", systemImage: "safari") }
            }
        }
        .formStyle(.grouped)
    }
}
