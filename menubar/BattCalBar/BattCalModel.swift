import Foundation
import SwiftUI
import UserNotifications

// What the menu bar label shows next to the battery glyph. macOS already has
// its own percent readout, so the smart default is time-to-target.
enum LabelStyle: String, CaseIterable, Identifiable {
    case live, iconOnly, eta, power, health
    var id: String { rawValue }
    var title: String {
        switch self {
        case .live: return "Watts + time"
        case .iconOnly: return "Icon only"
        case .eta: return "Time left"
        case .power: return "Watts"
        case .health: return "True health"
        }
    }
}

struct EngineStatus: Codable {
    var state: String
    var paused: Bool
    var breakUntil: Int?   // unix epoch a timed benchmark break auto-resumes at; nil = indefinite pause / none
    var mode: String
    var band: Band
    var pct: Int?
    var charging: Bool
    var plugged: Bool
    var adapterW: Int
    var batteryW: Double?
    var amperageMa: Double?
    var rawCurrentMah: Double?
    var rawMah: Double?
    var rawHealthPct: Double?
    var appleHealth: String?
    var cycles: Int?
    var designMah: Double?
    var nominalMah: Double?
    var nominalHealthPct: Double?
    var designCycles: Int?
    var condition: String?
    var prep: PrepInfo?
    var namespace: String?   // launchctl agent label the server detected; nil on older servers
    var onBatteryMin: Double?   // minutes in the current contiguous discharge run; nil when not discharging

    struct Band: Codable { var low: Int; var high: Int }
    struct PrepInfo: Codable { var active: Bool; var startedAt: Double? }
}

struct TelemetryPoint: Codable, Identifiable {
    var ts: String
    var pct: Double
    var id: String { ts }

    enum CodingKeys: String, CodingKey {
        case ts, pct
    }

    static let parser: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    var date: Date { Self.parser.date(from: ts) ?? .distantPast }
}

@MainActor
final class BattCalModel: ObservableObject {
    @Published var status: EngineStatus?
    @Published var spark: [TelemetryPoint] = []
    @Published var liveBuffer: [TelemetryPoint] = []   // live /api/status samples, so the chart survives a pause
    @Published var engineLoaded = true
    @Published var reachable = true
    private var ampHistory: [Double] = []

    private let base = URL(string: "http://localhost:4437")!
    private var timer: Timer?
    // The launchctl agent label + plist, derived from the namespace the server reports so a published
    // install (com.battcal.calibrate) is loaded/booted correctly; falls back to the personal label when
    // the server is older or unreachable.
    private var agentLabel: String { status?.namespace ?? "com.parsa.battery-calibrate" }
    private var agentPlist: String { ("~/Library/LaunchAgents/\(agentLabel).plist" as NSString).expandingTildeInPath }

    init() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
    }

    deinit {
        timer?.invalidate()
    }

    func refresh() {
        Task {
            do {
                let (d, _) = try await URLSession.shared.data(from: base.appendingPathComponent("api/status"))
                status = try JSONDecoder().decode(EngineStatus.self, from: d)
                reachable = true
                checkNotifications()
                if let a = status?.amperageMa {
                    ampHistory.append(a)
                    if ampHistory.count > 5 { ampHistory.removeFirst(ampHistory.count - 5) }
                }
                // Roll a live buffer of status samples so the popover chart stays populated while
                // paused (the engine writes the telemetry CSV only while cycling). Cap ~3h at 15s.
                if let s = status, let p = s.pct {
                    liveBuffer.append(TelemetryPoint(ts: TelemetryPoint.parser.string(from: Date()),
                                                     pct: Double(p)))
                    if liveBuffer.count > 720 { liveBuffer.removeFirst(liveBuffer.count - 720) }
                }
            } catch {
                reachable = false
            }
            if let url = URL(string: "api/telemetry?hours=3", relativeTo: base),
               let (d, _) = try? await URLSession.shared.data(from: url),
               let pts = try? JSONDecoder().decode([TelemetryPoint].self, from: d) {
                spark = pts
            }
            // Run the blocking `launchctl print` off the main actor so the 15s poll never
            // stalls the UI; the result assignment resumes back on MainActor after the await.
            let label = agentLabel
            let loaded = await Task.detached { Self.run("/bin/launchctl", ["print", "gui/\(getuid())/\(label)"]) == 0 }.value
            engineLoaded = loaded
        }
    }

    // Native alerts on meaningful transitions. Previous values persist in UserDefaults so
    // a restart does not re-fire. The engine already notifies on Condition changes, so this
    // covers cycle-complete and the 80% true-health threshold.
    private func checkNotifications() {
        guard let s = status else { return }
        let d = UserDefaults.standard
        if let c = s.cycles {
            if let last = d.object(forKey: "notif.cycles") as? Int, c > last {
                notify(id: "cycle-\(c)", "Cycle complete", "BattCal logged cycle \(c). Cycled for the AppleCare push.")
            }
            d.set(c, forKey: "notif.cycles")
        }
        if let h = s.rawHealthPct {
            let wasBelow = d.bool(forKey: "notif.below80")
            let isBelow = h < 80
            if isBelow && !wasBelow {
                notify(id: "below80", "True health below 80%", String(format: "Raw capacity is %.1f%%, into AppleCare-replacement territory.", h))
            }
            d.set(isBelow, forKey: "notif.below80")
        }
    }
    private func notify(id: String, _ title: String, _ body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }

    private func post(_ path: String) {
        Task {
            var req = URLRequest(url: base.appendingPathComponent(path))
            req.httpMethod = "POST"
            _ = try? await URLSession.shared.data(for: req)
            refresh()
        }
    }

    func pause() { post("api/pause") }
    func resume() { post("api/resume") }

    // Timed "benchmark break": pause calibration now, auto-resume after `minutes`.
    // Uses a relative URL with a query (not post(), which would encode the "?").
    func benchmarkBreak(minutes: Int) {
        Task {
            var req = URLRequest(url: URL(string: "api/break?minutes=\(minutes)", relativeTo: base)!)
            req.httpMethod = "POST"
            _ = try? await URLSession.shared.data(for: req)
            refresh()
        }
    }

    // True only while the battery is ACTUALLY discharging (adapter cut) and macOS is
    // power-throttling the CPU. During an idle-gate activity hold the state is still
    // "drain" but the adapter is re-enabled, so gate on real power flow, not the label.
    var isDischarging: Bool { reachable && engineLoaded && (status?.batteryW ?? 0) < -0.5 }

    // Actual power flow right now, from measured battery watts (positive = charging,
    // negative = discharging). This is the SOURCE OF TRUTH for every readout: during an
    // idle-gate activity hold the engine state is still "drain" while the adapter is
    // re-enabled and the battery charges, so never infer direction from `state`.
    enum Flow { case charging, draining, steady }
    var flow: Flow {
        if let w = status?.batteryW {
            if w > 0.5 { return .charging }
            if w < -0.5 { return .draining }
            return .steady
        }
        if status?.charging == true { return .charging }
        if status?.state == "drain" { return .draining }
        return .steady
    }

    // The percentage the battery is currently heading toward, given the real flow.
    // Charging: band.high during a real charge phase, else the 100% batt limit during an
    // activity-hold top-up. Draining: the band floor. Steady: nowhere (holding).
    var flowTarget: Int? {
        guard let s = status else { return nil }
        switch flow {
        case .charging: return s.state == "charge" ? s.band.high : 100
        case .draining: return s.band.low
        case .steady:   return nil
        }
    }

    // Directional battery power for the menu bar: IN when charging, OUT when draining.
    // batteryW is +ve charging / -ve draining, so flow + magnitude give an unambiguous
    // in/out reading in EVERY mode (including normal), which the old mode word hid.
    var powerLabel: String? {
        guard let w = status?.batteryW else { return nil }
        switch flow {
        case .charging: return String(format: "IN %.1fW", abs(w))
        case .draining: return String(format: "OUT %.1fW", abs(w))
        case .steady:   return String(format: "%.1fW", abs(w))
        }
    }

    // Signed battery watts for the menu bar: +X.XW charging, -X.XW draining (batteryW is
    // +charging / -draining, so %+ yields the sign directly). The sign carries direction.
    var signedWatts: String? {
        guard let w = status?.batteryW else { return nil }
        return String(format: "%+.1fW", w)
    }

    // Time to where the battery is heading, as H:MM (drain: to the band floor; charge: to full).
    var timeLeftText: String? {
        guard let (mins, _) = minutesToTarget else { return nil }
        return String(format: "%d:%02d", mins / 60, mins % 60)
    }

    // "Watts + time" menu bar text: signed watts, plus the time-left when available.
    var wattsPlusTime: String? {
        guard let w = signedWatts else { return nil }
        if let t = timeLeftText { return "\(w) \u{00B7} \(t)" }
        return w
    }

    // "Flat" = no meaningful power flow: steady, or charging at a trickle near full. Both are cases
    // where a live wattage would read ~0.0W, so the menu bar shows the percent instead of a dead 0.0W.
    var isFlatFlow: Bool {
        flow == .steady || (flow == .charging && abs(status?.batteryW ?? 0) < 1)
    }

    // Chart source: engine telemetry while cycling, else the live status buffer, so the popover
    // keeps a chart during a pause (when the engine writes no telemetry).
    var chartData: [TelemetryPoint] { spark.isEmpty ? liveBuffer : spark }

    // Epoch a timed benchmark break auto-resumes at (nil when none is active).
    var breakUntil: Int? { status?.breakUntil }

    // Seconds left in an active timed benchmark break, or nil if none. Pass the
    // TimelineView clock so the countdown ticks smoothly while the popover is open.
    func breakRemaining(asOf now: Date = Date()) -> Int? {
        guard let until = status?.breakUntil else { return nil }
        let left = until - Int(now.timeIntervalSince1970)
        return left > 0 ? left : nil
    }
    func setMode(_ m: String) {
        Task {
            var req = URLRequest(url: URL(string: "api/mode?mode=\(m)", relativeTo: base)!)
            req.httpMethod = "POST"
            _ = try? await URLSession.shared.data(for: req)
            refresh()
        }
    }

    // The three states the user picks between. Off only appears if the engine
    // agent was manually stopped; selecting any state brings it back.
    enum ActiveMode: String { case longevity, calibration, normal, off }

    var activeMode: ActiveMode {
        guard reachable, engineLoaded else { return .off }
        // A timed benchmark break sets paused + a breakUntil epoch. Keep the underlying mode active
        // so the selector does not read "Normal charging" while a calibration break counts down; a
        // genuine indefinite pause (no breakUntil) is the real Normal state.
        if status?.paused == true, status?.breakUntil == nil { return .normal }
        return status?.mode == "calibration" ? .calibration : .longevity
    }

    func select(_ target: ActiveMode) {
        Task {
            if !engineLoaded, target != .off {
                let args = ["bootstrap", "gui/\(getuid())", agentPlist]
                _ = await Task.detached { Self.run("/bin/launchctl", args) }.value
            }
            switch target {
            case .longevity, .calibration:
                var r = URLRequest(url: base.appendingPathComponent("api/resume")); r.httpMethod = "POST"
                _ = try? await URLSession.shared.data(for: r)
                var m = URLRequest(url: URL(string: "api/mode?mode=\(target.rawValue)", relativeTo: base)!); m.httpMethod = "POST"
                _ = try? await URLSession.shared.data(for: m)
            case .normal:
                var p = URLRequest(url: base.appendingPathComponent("api/pause")); p.httpMethod = "POST"
                _ = try? await URLSession.shared.data(for: p)
            case .off:
                break
            }
            refresh()
        }
    }

    func openDashboard() {
        NSWorkspace.shared.open(URL(string: "https://battcal.localhost")!)
    }

    @discardableResult
    nonisolated static func run(_ bin: String, _ args: [String]) -> Int32 {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: bin)
        p.arguments = args
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        do { try p.run() } catch { return -1 }
        p.waitUntilExit()
        return p.terminationStatus
    }

    // Popover header battery glyph: battery level + state overlays. (Fine to look like a
    // battery here; it sits next to the big % inside the popover.)
    var symbolName: String {
        guard reachable, let s = status, let pct = s.pct else { return "battery.slash" }
        // Battery glyph for the current level; used for the engine-off state and as the flat fallback,
        // so an engine-off Mac at a low % never draws a FULL battery next to its real percentage.
        let levelGlyph: String
        switch pct {
        case ..<13: levelGlyph = "battery.0percent"
        case ..<38: levelGlyph = "battery.25percent"
        case ..<63: levelGlyph = "battery.50percent"
        case ..<88: levelGlyph = "battery.75percent"
        default:    levelGlyph = "battery.100percent"
        }
        if !engineLoaded { return levelGlyph }
        // A real charge shows an up-arrow (symmetric with the drain's down-arrow below), so the header
        // does not read "paused" while charging.
        if !isFlatFlow, flow == .charging { return "arrow.up.circle" }
        // A real drain shows the drain arrow, matching the menu bar and the Power tile.
        if !isFlatFlow, flow == .draining { return "arrow.down.circle" }
        // The pause glyph is ONLY for a genuine hold (flat + paused).
        if isFlatFlow, s.paused { return "pause.circle" }
        return levelGlyph
    }

    // Menu bar glyph: the BattCal brand mark, DISTINCT from macOS's plain battery icon on purpose.
    // The band-cycler emblem (a battery block with plus/minus) is the resting look; while power
    // actually flows it marks FLOW DIRECTION (bolt-block = charging, down-arrow = draining); a genuine
    // hold shows the pause glyph. An unreachable server shows a warning triangle.
    func menuBarSymbol(for style: LabelStyle) -> String {
        guard reachable else { return "exclamationmark.triangle" }
        if !engineLoaded { return "pause.circle" }
        // A real charge/drain wins over the paused glyph: in Normal mode the engine is paused but
        // macOS still trickle-charges, so mark the true flow direction, never a "paused" glyph
        // next to a live "IN/OUT" watts readout. isFlatFlow already treats a sub-1W charging
        // trickle as flat, so only a genuine flow trips the bolt/arrow.
        if !isFlatFlow { return flow == .draining ? "arrow.down.circle" : "bolt.batteryblock.fill" }
        if status?.paused == true { return "pause.circle" }
        return "minus.plus.batteryblock.fill"
    }

    // The menu bar value text. The signed watts / time already carry direction (plus the leading
    // glyph), so there is no IN/OUT prefix to strip.
    func menuBarValue(for style: LabelStyle) -> String? {
        return menuLabel(for: style)
    }

    // VoiceOver description for the menu bar item: describe what is ACTUALLY shown for this style.
    func menuBarAccessibility(for style: LabelStyle) -> String {
        guard reachable else { return "BattCal: server offline" }
        if let v = menuBarValue(for: style), !v.isEmpty { return "BattCal: \(stateLine), \(v)" }
        return "BattCal: \(stateLine)"
    }

    var titleText: String {
        guard reachable, let pct = status?.pct else { return "--" }
        return "\(pct)%"
    }

    // Estimated minutes until the battery reaches where it is heading, in the ACTUAL
    // direction of flow (not the engine state). Gauge math like the OS: remaining mAh to
    // target / current draw, draw = a short median so a momentary spike does not whipsaw.
    var minutesToTarget: (mins: Int, target: Int)? {
        guard reachable, engineLoaded, let s = status, !s.paused,
              let cur = s.rawCurrentMah, let max = s.rawMah, max > 0,
              let target = flowTarget else { return nil }
        let amps = ampHistory.sorted()
        guard !amps.isEmpty else { return nil }
        let amp = amps[amps.count / 2]
        guard abs(amp) > 50 else { return nil }
        let targetMah = Double(target) / 100 * max
        let deltaMah = targetMah - cur
        // Direction sanity: the draw sign must match the heading (charging up = amp>0 &
        // delta>0; draining down = amp<0 & delta<0). Otherwise it is a transition; bail.
        guard deltaMah * amp > 0 else { return nil }
        let mins = deltaMah / amp * 60
        guard mins.isFinite, mins > 0, mins < 48 * 60 else { return nil }
        return (Int(mins), target)
    }

    var etaText: String? {
        guard let (mins, target) = minutesToTarget else { return nil }
        let t = mins >= 60 ? "\(mins / 60)h\(String(format: "%02d", mins % 60))" : "\(mins)m"
        return "\(t)→\(target)%"
    }

    // Menu bar text drawn next to the glyph (iconOnly and idle flow-views draw the glyph alone).
    // macOS already shows the charge %, so we NEVER echo it here: the flow views collapse to the
    // glyph when flat, and True health is CAPACITY (not charge), so it is not redundant.
    func menuLabel(for style: LabelStyle) -> String? {
        if style == .iconOnly { return nil }
        guard reachable else { return "--" }
        if activeMode == .off { return "off" }      // engine stopped: nothing live to show
        switch style {
        // Flow views: the live reading while power flows; at idle collapse to the glyph only (nil),
        // never the redundant charge % that Apple's own menu bar icon already shows.
        case .live:    return isFlatFlow ? nil : wattsPlusTime
        case .power:   return isFlatFlow ? nil : signedWatts
        case .eta:     return isFlatFlow ? nil : (timeLeftText ?? signedWatts)
        // True health is measured capacity vs design, distinct from the charge %, so always show it.
        case .health:  return status?.rawHealthPct.map { String(format: "%.1f%%", $0) }
        case .iconOnly: return nil
        }
    }

    var stateLine: String {
        guard reachable else { return "BattCal server offline" }
        guard let s = status else { return "Reading battery…" }
        if !engineLoaded { return "Off - charging like normal" }
        if s.paused {
            // A break (paused WITH a future breakUntil) is not the Normal state; the popover banner
            // shows its live countdown, so keep this line consistent with it, not "Normal charging".
            if let until = s.breakUntil, until > Int(Date().timeIntervalSince1970) { return "Benchmark break active" }
            return "Normal charging (Apple default)"
        }
        switch flow {
        case .charging: return "Charging to \(flowTarget ?? s.band.high)%"
        case .draining: return "Draining to \(s.band.low)%"
        case .steady:
            if s.state == "hold" { return "Holding at full (calibration)" }
            return "Holding at \(s.pct ?? 0)%"
        }
    }

    var stateColor: Color {
        guard reachable, let s = status, engineLoaded else { return .secondary }
        if s.paused { return .blue }
        switch flow {
        case .draining: return .orange
        case .charging, .steady: return .green
        }
    }
}
