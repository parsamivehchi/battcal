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

            // Throttle warning while draining, or a live countdown during a break.
            // The 1s TimelineView only spins up when one of them is on screen.
            if model.isDischarging || model.breakUntil != nil {
                TimelineView(.periodic(from: .now, by: 1)) { ctx in
                    bannerContent(now: ctx.date)
                }
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

            // Mode selector: three clear, obviously-active rows
            Text("MODE").font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary).padding(.top, 2)
            VStack(spacing: 6) {
                modeRow(.longevity, "arrow.triangle.2.circlepath", "Longevity", "Cycle 10-90%, never sits at full", .green)
                modeRow(.calibration, "gauge.with.needle", "Calibration", "Full 5-100% passes, re-learns health", .orange)
                modeRow(.normal, "bolt.fill", "Normal charging", "Apple's default \u{2013} charges to 100%", .blue)
            }
            if !model.reachable {
                Text("BattCal server offline \u{2013} controls disabled").font(.caption).foregroundStyle(.secondary)
            }

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
        parts.append(s?.plugged == true ? "Plugged in · \(s?.adapterW ?? 0) W adapter" : "On battery")
        if let (mins, target) = model.minutesToTarget {
            let t = mins >= 60 ? "\(mins / 60)h \(mins % 60)m" : "\(mins)m"
            parts.append("~\(t) until \(target)% at current draw")
        }
        if model.engineLoaded, s?.paused != true, model.flow == .draining, s?.plugged == true {
            parts.append(s?.mode == "calibration" ? "charger LED pulses green" : "charger LED dark = BattCal draining")
        }
        return parts.joined(separator: " · ")
    }

    // Picks the right banner for the current power state: a live countdown while a
    // benchmark break runs, otherwise a power-throttle warning while draining.
    @ViewBuilder private func bannerContent(now: Date) -> some View {
        if let remaining = model.breakRemaining(asOf: now) {
            banner(tint: .blue, icon: "bolt.fill",
                   title: "Benchmark break active",
                   message: "Full speed now. Resumes calibration in \(fmtDuration(remaining)). Run Geekbench.",
                   actionTitle: "Resume calibration now") { model.resume() }
        } else if model.isDischarging {
            let onBattery = model.status?.plugged != true
            banner(tint: .orange, icon: "exclamationmark.triangle.fill",
                   title: "CPU is power-throttled",
                   message: onBattery
                       ? "On battery. CPU-heavy benchmarks score lower than plugged in, and worse as the battery drops."
                       : "BattCal is draining (adapter cut), so the Mac runs on battery. Benchmarks and heavy compute score low, and worse as % drops.",
                   actionTitle: "Benchmark break (30 min)") { model.benchmarkBreak(minutes: 30) }
        }
    }

    private func banner(tint: Color, icon: String, title: String, message: String,
                        actionTitle: String, action: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: icon).foregroundStyle(tint).font(.system(size: 14, weight: .semibold))
                Text(title).font(.callout.weight(.semibold))
                Spacer()
            }
            Text(message).font(.caption).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: action) {
                Text(actionTitle).font(.caption.weight(.semibold))
                    .frame(maxWidth: .infinity).padding(.vertical, 6)
                    .background(tint.opacity(0.9), in: RoundedRectangle(cornerRadius: 7))
                    .foregroundStyle(.white)
            }
            .buttonStyle(.plain)
            .disabled(!model.reachable)
            .opacity(model.reachable ? 1 : 0.5)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10).fill(tint.opacity(0.12)))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(tint.opacity(0.35), lineWidth: 1))
    }

    private func fmtDuration(_ secs: Int) -> String {
        String(format: "%d:%02d", secs / 60, secs % 60)
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label.uppercased()).font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
            Text(value).font(.callout.weight(.semibold)).monospacedDigit().foregroundStyle(.primary)
        }
        .frame(minWidth: 120, alignment: .leading)
    }

    // One selectable mode row. Active = filled with the mode color + checkmark;
    // inactive = subtle fill, tap to switch.
    private func modeRow(_ mode: BattCalModel.ActiveMode, _ icon: String, _ title: String, _ subtitle: String, _ tint: Color) -> some View {
        let active = model.activeMode == mode
        return Button { model.select(mode) } label: {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(active ? tint : .secondary)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.callout.weight(.semibold)).foregroundStyle(.primary)
                    Text(subtitle).font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
                if active {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(tint)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.vertical, 7).padding(.horizontal, 10)
        .background(
            RoundedRectangle(cornerRadius: 9)
                .fill(active ? tint.opacity(0.16) : Color.primary.opacity(0.05))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 9)
                .strokeBorder(active ? tint.opacity(0.7) : Color.clear, lineWidth: 1.5)
        )
        .disabled(!model.reachable)
        .opacity(model.reachable ? 1 : 0.5)
    }
}
