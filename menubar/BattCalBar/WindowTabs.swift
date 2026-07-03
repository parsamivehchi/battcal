import SwiftUI
import Charts

// A compact icon stat cell shared by the window tabs.
struct StatCell: View {
    let icon: String
    let label: String
    let value: String
    var body: some View {
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
}

// A label / value row for the Genius Bar evidence card.
struct KeyValueRow: View {
    let label: String
    let value: String
    var tint: Color = .primary
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(label).font(.subheadline).foregroundStyle(.secondary)
                Spacer()
                Text(value).font(.system(.subheadline, design: .rounded).weight(.semibold)).monospacedDigit().foregroundStyle(tint)
            }
            .padding(.vertical, 6)
            Divider().opacity(0.4)
        }
    }
}

// History: true-health-per-cycle trend + impact-since-BattCal-started.
struct HistoryTab: View {
    @ObservedObject var model: BattCalModel
    private var design: Double { model.status?.designMah ?? 6075 }
    private var points: [HealthPoint] {
        model.cycles.compactMap { row in
            guard let raw = row.raw_mAh, row.day > .distantPast else { return nil }
            return HealthPoint(date: row.day, health: raw / design * 100)
        }
    }

    var body: some View {
        ScrollView {
            GlassStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 12) {
                    GlassCard {
                        VStack(alignment: .leading, spacing: 8) {
                            SectionLabel(text: "TRUE HEALTH PER CYCLE")
                            if points.count < 2 {
                                Text("Not enough cycles logged yet. Health snapshots accumulate as BattCal completes 10-90 passes.")
                                    .font(.caption).foregroundStyle(.secondary).frame(height: 160, alignment: .center)
                                    .frame(maxWidth: .infinity)
                            } else {
                                chart
                            }
                        }
                    }
                    GlassCard {
                        VStack(alignment: .leading, spacing: 10) {
                            SectionLabel(text: "IMPACT SINCE BATTCAL STARTED")
                            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 13) {
                                GridRow {
                                    StatCell(icon: "arrow.triangle.2.circlepath", label: "Cycles",
                                             value: "\(model.status?.cycles ?? 0)" + (model.status?.designCycles.map { " / \($0)" } ?? ""))
                                    StatCell(icon: "speedometer", label: "Pace", value: pace)
                                }
                                GridRow {
                                    StatCell(icon: "heart.fill", label: "True health now",
                                             value: model.status?.rawHealthPct.map { String(format: "%.1f%%", $0) } ?? "--")
                                    StatCell(icon: "arrow.up.arrow.down", label: "Change since start", value: change)
                                }
                            }
                        }
                    }
                    dashboardButton(model)
                }
                .padding(16)
            }
        }
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
        .chartYAxis { AxisMarks { AxisGridLine().foregroundStyle(Color.primary.opacity(0.08)); AxisValueLabel().font(.system(size: 8)) } }
        .frame(height: 170)
    }

    private var change: String {
        guard let f = points.first, let l = points.last else { return "--" }
        let d = l.health - f.health
        return String(format: "%+.1f pp", d)
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

struct HealthPoint: Identifiable {
    let date: Date
    let health: Double
    var id: Date { date }
}

// Genius Bar: honest AppleCare evidence + a one-tap pre-appointment calibration cycle.
struct GeniusBarTab: View {
    @ObservedObject var model: BattCalModel
    private var ev: Evidence? { model.evidence }
    private var symptoms: Bool { ev?.symptomsFound == true }
    private var prepActive: Bool { model.status?.prep?.active == true }

    var body: some View {
        ScrollView {
            GlassStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 12) {
                    GlassCard(tint: symptoms ? .orange : .green) {
                        HStack(spacing: 10) {
                            Image(systemName: symptoms ? "exclamationmark.triangle.fill" : "checkmark.seal.fill")
                                .foregroundStyle(symptoms ? .orange : .green).font(.title2)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(symptoms ? "Behavioral symptoms found" : "No hardware symptoms found")
                                    .font(.callout.weight(.semibold))
                                Text("Apple decides on the macOS Maximum Capacity number, not the raw gauge. This is honest evidence only, never fabricated.")
                                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer()
                        }
                    }

                    GlassCard {
                        VStack(alignment: .leading, spacing: 6) {
                            SectionLabel(text: "HONEST EVIDENCE")
                            if ev == nil {
                                Text("Computing from telemetry...").font(.caption).foregroundStyle(.secondary).padding(.vertical, 8)
                            } else {
                                KeyValueRow(label: "macOS capacity", value: ev?.macos?.capacity ?? "--")
                                KeyValueRow(label: "Condition", value: ev?.macos?.condition ?? "--")
                                KeyValueRow(label: "Estimated runtime",
                                            value: ev?.runtime?.hours.map { String(format: "%.1f h", $0) } ?? "n/a")
                                KeyValueRow(label: "Internal resistance",
                                            value: ev?.resistanceMohm.map { String(format: "%.0f mOhm", $0) } ?? "--",
                                            tint: ev?.resistanceElevated == true ? .orange : .primary)
                                KeyValueRow(label: "Unexpected shutdowns", value: "\(ev?.shutdowns?.count ?? 0)",
                                            tint: (ev?.shutdowns?.isEmpty == false) ? .orange : .primary)
                                KeyValueRow(label: "Projected at design cycles",
                                            value: ev?.projection?.projectedAtDesign.map { String(format: "%.0f%%", $0) } ?? "--")
                            }
                        }
                    }

                    if prepActive {
                        GlassActionButton(title: "End pre-appointment prep", icon: "stop.circle.fill", tint: .red, enabled: model.reachable) { model.endPrep() }
                    } else {
                        Button { model.prep() } label: {
                            HStack {
                                Image(systemName: "cross.case.fill")
                                Text("Run pre-appointment cycle").fontWeight(.semibold)
                                Spacer()
                                Image(systemName: "arrow.right")
                            }
                            .frame(maxWidth: .infinity).padding(.vertical, 3).contentShape(Rectangle())
                        }
                        .glassButtonStyle(prominent: true, tint: .orange)
                        .controlSize(.large)
                        .disabled(!model.reachable)
                    }

                    dashboardButton(model)
                }
                .padding(16)
            }
        }
    }
}

// Shared "Open web dashboard" footer button.
@ViewBuilder func dashboardButton(_ model: BattCalModel) -> some View {
    Button { model.openDashboard() } label: {
        HStack {
            Image(systemName: "chart.xyaxis.line")
            Text("Open web dashboard").fontWeight(.semibold)
            Spacer()
            Image(systemName: "arrow.up.forward").font(.caption)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 3).contentShape(Rectangle())
    }
    .glassButtonStyle(prominent: true, tint: .accentColor)
    .controlSize(.large)
}
