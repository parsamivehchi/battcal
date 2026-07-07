import SwiftUI
import ServiceManagement

struct PopoverView: View {
    @ObservedObject var model: BattCalModel
    @ObservedObject var wifi: WiFiMonitor
    var onPopOut: () -> Void = {}
    var onOpenSettings: () -> Void = {}   // routed to AppDelegate.showSettings() by both hosts
    var inWindow: Bool = false   // true when hosted in the standalone window (no pop-out button)

    private var s: EngineStatus? { model.status }

    // "Time left" to the cycle target while cycling; "Battery left" (time to empty at the current
    // draw) while running on battery; else "--".
    private var timeTile: (label: String, value: String) {
        if let t = model.timeLeftText { return ("Time left", t) }
        if let b = model.batteryLeftText { return ("Battery left", b) }
        return ("Time left", "--")
    }

    // Compact home-cycling status for the popover footer (full control lives in Settings > Home Cycling).
    private var homeStatusLine: String {
        if !wifi.authorized { return "Home cycling: grant location in Settings" }
        guard let s = wifi.ssid, !s.isEmpty else { return "Away (no Wi-Fi) \u{00B7} charging normally" }
        return wifi.atHome ? "\(s) \u{00B7} cycling here" : "\(s) \u{00B7} away, charging normally"
    }
    private var homeIcon: String { (wifi.atHome && wifi.authorized) ? "house.fill" : "house" }
    private var homeColor: Color { (wifi.atHome && wifi.authorized) ? .green : .secondary }

    // Elapsed time in the current on-battery (discharge) run, H:MM, from the server.
    private var onBatteryText: String {
        guard let m = s?.onBatteryMin, m > 0 else { return "--" }
        let mins = Int(m)
        return String(format: "%d:%02d", mins / 60, mins % 60)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header: big battery number + live state, with a pop-out-to-window button.
            HStack(alignment: .top) {
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
                }
                Spacer()
                if !inWindow {
                    Button(action: onPopOut) {
                        Image(systemName: "macwindow").font(.title3).foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .help("Open the BattCal window")
                    .accessibilityLabel("Open BattCal window")
                }
            }

            // Throttle warning while draining, or a live countdown during a break.
            if model.isCyclingDrain || model.breakRemaining() != nil {
                TimelineView(.periodic(from: .now, by: 1)) { ctx in
                    PowerBanner(model: model, now: ctx.date)
                }
            }

            // Battery % history. BattCal shows no temperature (a separate app covers it), so the
            // chart no longer swaps to a temperature series when the % holds flat.
            if !model.chartData.isEmpty {
                LiveChart(spark: model.chartData)
            }

            // Mode selector
            Text("MODE").font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary).padding(.top, 2)
            ModeSelector(model: model)
            if !model.reachable {
                Text("BattCal server offline - controls disabled").font(.caption).foregroundStyle(.secondary)
            }

            // Stats grid
            // Grouped by theme: live flow (row 1), the two health readings side by side for the
            // core comparison (row 2), then the lifetime / elapsed counters (row 3).
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 4) {
                GridRow {
                    powerStat()
                    stat(timeTile.label, "hourglass", timeTile.value)
                }
                GridRow {
                    stat("True health", "heart.fill", s?.rawHealthPct.map { String(format: "%.1f%%", $0) } ?? "--")
                    stat("Apple says", "apple.logo", s?.appleHealth ?? "--")
                }
                GridRow {
                    stat("Cycles", "arrow.triangle.2.circlepath", s?.cycles.map { "\($0)" } ?? "--")
                    stat("On battery", "battery.25percent", onBatteryText)
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
                if wifi.homeGateEnabled {
                    HStack(spacing: 5) {
                        Image(systemName: homeIcon).font(.caption2).foregroundStyle(homeColor)
                        Text(homeStatusLine).font(.caption).foregroundStyle(.secondary)
                        Spacer()
                    }
                }
                HStack(spacing: 10) {
                    Button { onOpenSettings() } label: { Label("Settings", systemImage: "gearshape") }
                        .buttonStyle(.plain).font(.caption)
                    Spacer()
                    Button("Quit") { NSApp.terminate(nil) }.font(.caption)
                }
            }
        }
        .padding(14)
        .frame(width: 340)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var subline: String {
        var parts: [String] = []
        if s?.plugged == true {
            parts.append("Plugged in \u{00B7} \(s?.adapterW ?? 0) W adapter")
        } else if s?.paused == true {
            parts.append("Normal charging when plugged in")   // user chose Normal; on battery now
        } else {
            parts.append("Cycling resumes when plugged in")
        }
        if let (mins, target) = model.minutesToTarget {
            let t = mins >= 60 ? "\(mins / 60)h \(mins % 60)m" : "\(mins)m"
            parts.append("~\(t) until \(target)% at current draw")
        }
        if model.engineLoaded, s?.paused != true, model.flow == .draining, s?.plugged == true {
            parts.append(s?.mode == "calibration" ? "charger LED pulses green" : "charger LED dark = BattCal draining")
        }
        return parts.joined(separator: " \u{00B7} ")
    }

    // Symbol-first stat tile, matching powerStat() so the whole grid reads consistently:
    // a leading glyph in secondary tint + the value.
    private func stat(_ label: String, _ symbol: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label.uppercased()).font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
            HStack(spacing: 3) {
                Image(systemName: symbol).font(.caption2).foregroundStyle(.secondary)
                Text(value).font(.callout.weight(.semibold)).monospacedDigit().foregroundStyle(.primary)
            }
        }
        .frame(minWidth: 120, alignment: .leading)
    }

    // Compact, symbol-first Power tile: a direction glyph + bare magnitude while charging/draining
    // (the glyph carries direction), a steady glyph + short word while flat (never a dead "+0.0W").
    private func powerStat() -> some View {
        let symbol: String
        let value: String
        if let w = s?.batteryW {
            if model.isFlatFlow {
                // POWER is a flow field, not a charge level: show "Idle" (no power flowing), never "Full".
                symbol = "pause"
                value = "Idle"
            } else if model.flow == .draining {
                symbol = "arrow.down.circle"
                value = String(format: "%.1fW", abs(w))
            } else {
                symbol = "bolt.fill"
                value = String(format: "%.1fW", abs(w))
            }
        } else {
            symbol = "bolt.slash"
            value = "--"
        }
        return VStack(alignment: .leading, spacing: 0) {
            Text("POWER").font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
            HStack(spacing: 3) {
                Image(systemName: symbol).font(.caption2).foregroundStyle(.secondary)
                Text(value).font(.callout.weight(.semibold)).monospacedDigit().foregroundStyle(.primary)
            }
        }
        .frame(minWidth: 120, alignment: .leading)
    }
}
