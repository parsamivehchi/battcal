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
        // Describes the Wi-Fi GATE, not activity: the engine may be paused while at home,
        // so never assert "cycling here" (it contradicted the header's Normal charging).
        return wifi.atHome ? "\(s) \u{00B7} cycling allowed here" : "\(s) \u{00B7} away, charging normally"
    }
    private var homeIcon: String { (wifi.atHome && wifi.authorized) ? "house.fill" : "house" }
    private var homeColor: Color { (wifi.atHome && wifi.authorized) ? .green : .secondary }

    // Compact work-schedule status for the footer (editing lives in Settings > Work Schedule).
    private var scheduleLine: (text: String, active: Bool)? {
        guard let sc = s?.schedule, sc.enabled else { return nil }
        let days = sc.days ?? []
        let names = BattFormat.weekdayAbbrev
        // Contiguous runs read as a range ("Mon-Fri"); anything else lists the days.
        let daysText: String
        if days.count >= 2, let f = days.first, let l = days.last, days == Array(f...l) {
            daysText = "\(names[f - 1])-\(names[l - 1])"
        } else {
            daysText = days.map { names[$0 - 1] }.joined(separator: " ")
        }
        let t = { (hhmm: String?) -> String in
            guard let v = hhmm, v.count == 4 else { return "?" }
            return "\(Int(v.prefix(2)) ?? 0):\(v.suffix(2))"
        }
        let inWin = sc.inWindow == true
        return ("\(daysText) \(t(sc.start))-\(t(sc.end)) \u{00B7} \(inWin ? "work hours, cycling" : "off hours, charging normally")", inWin)
    }

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

            // Two installs present: controls silently target the first (personal) namespace, so
            // warn and name which one. Mirrors the dashboard's amber notice banner.
            if model.status?.namespaceConflict == true {
                notice("exclamationmark.triangle.fill", .orange,
                       "Two BattCal installs detected. Controls target \(model.status?.namespace ?? "the first install"). Remove the unused one.")
            }

            // Throttle warning while draining, or a live countdown during a break. Only the
            // countdown needs a per-second clock, so the TimelineView exists ONLY while a
            // real break epoch is set (a schedule pause carries an epoch too but shows no
            // countdown; its far-future clock must not tick all evening). The inner check
            // still clears the banner the second a break elapses; the plain drain warning
            // renders statically with no ticking.
            if model.breakUntil != nil, !model.isSchedulePaused {
                TimelineView(.periodic(from: .now, by: 1)) { ctx in
                    if model.isCyclingDrain || model.breakRemaining(asOf: ctx.date) != nil {
                        PowerBanner(model: model, now: ctx.date)
                    }
                }
            } else if model.isCyclingDrain {
                PowerBanner(model: model, now: Date())
            }

            // Battery % history. BattCal shows no temperature (a separate app covers it), so the
            // chart no longer swaps to a temperature series when the % holds flat.
            if !model.chartData.isEmpty {
                LiveChart(spark: model.chartData)
            }

            // Mode selector
            Text("MODE").font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary).padding(.top, 2)
            ModeSelector(model: model)
            // Genius Bar prep (dashboard-started) pins calibration mode; badge it here so the
            // selector reading "Calibration" is never a mystery. Picking another mode clears it.
            if model.prepActive {
                notice("wrench.and.screwdriver.fill", .orange,
                       "Genius Bar prep running - holds calibration until stopped. Picking another mode stops it.")
            }
            // macOS's own battery verdict, only when it is news ("Service Recommended").
            if let cond = model.serviceCondition {
                notice("exclamationmark.circle.fill", .red, "macOS battery condition: \(cond)")
            }
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
                    stat("On battery", s?.pct.map { BattCalModel.batteryGlyph(for: $0) } ?? "battery.25percent",
                         onBatteryText)
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
                if let sched = scheduleLine {
                    HStack(spacing: 5) {
                        Image(systemName: "calendar.badge.clock").font(.caption2)
                            .foregroundStyle(sched.active ? Color.purple : .secondary)
                        Text(sched.text).font(.caption).foregroundStyle(.secondary)
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

    // Compact tinted notice row (the namespace-conflict banner grammar), shared by every
    // inline warning so they read as one family.
    private func notice(_ symbol: String, _ tint: Color, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: symbol).font(.caption2).foregroundStyle(tint)
            Text(text).font(.caption2).foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 5).padding(.horizontal, 8)
        .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
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
