import Foundation
import SwiftUI
import UserNotifications

// What the menu bar label shows next to the battery glyph. macOS already has
// its own percent readout, so the smart default is time-to-target.
enum LabelStyle: String, CaseIterable, Identifiable {
    case live, iconOnly, eta, power, percent, health
    var id: String { rawValue }
    var title: String {
        switch self {
        case .live: return "Watts + time"
        case .iconOnly: return "Icon only"
        case .eta: return "Time left"
        case .power: return "Watts"
        case .percent: return "Percent"
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
    var tempC: Double?
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
    var tempC: Double?          // pack temperature; the engine writes 0.0 on a failed ioreg read
    var id: String { ts }

    enum CodingKeys: String, CodingKey {
        case ts, pct
        case tempC = "temp_C"
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
    @Published var vitalIndex = 0        // advances every 5s to rotate the Live-vitals menu bar label
    private var ampHistory: [Double] = []

    private let base = URL(string: "http://localhost:4437")!
    private var timer: Timer?
    private var vitalTimer: Timer?
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
        // Rotate the Live-vitals label (health -> temp -> cycles) on its own 5s cadence,
        // independent of the 15s data poll.
        vitalTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.vitalIndex &+= 1 }
        }
    }

    deinit {
        timer?.invalidate()
        vitalTimer?.invalidate()
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
                                                     pct: Double(p), tempC: s.tempC))
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

    // Rotating "live vitals" for the menu bar while the battery is flat (full / holding / normal
    // charging), where a watts readout would just read 0.0W. Rotates true-health and cycle-count
    // every 5s (see vitalTimer). Skips any datum the engine has not reported yet. Battery temperature
    // is deliberately NOT shown here: it duplicated a separate menu-bar temperature app (two degree
    // readouts). Do not re-add it. The popover still charts temperature.
    var steadyVitals: [(symbol: String, text: String, label: String)] {
        guard let s = status else { return [] }
        var v: [(String, String, String)] = []
        if let h = s.rawHealthPct { v.append(("heart.fill", String(format: "%.0f%%", h), "True health")) }
        if let c = s.cycles { v.append(("arrow.triangle.2.circlepath", "\(c)", "Cycles")) }
        return v
    }

    var currentVital: (symbol: String, text: String, label: String)? {
        let v = steadyVitals
        // vitalIndex wraps (&+=) and can go negative at Int.max; a plain % would then be a negative,
        // out-of-bounds index. Normalize to a non-negative index.
        return v.isEmpty ? nil : v[((vitalIndex % v.count) + v.count) % v.count]
    }

    // "Flat" = no meaningful power flow: steady, or charging at a trickle near full. Both are cases
    // where a live wattage would read ~0.0W, so the Live style rotates vitals instead.
    var isFlatFlow: Bool {
        flow == .steady || (flow == .charging && abs(status?.batteryW ?? 0) < 1)
    }

    // Chart source: engine telemetry while cycling, else the live status buffer, so the popover
    // keeps a chart during a pause (when the engine writes no telemetry).
    var chartData: [TelemetryPoint] { spark.isEmpty ? liveBuffer : spark }

    // The header sparkline pins a flat line while the battery holds (e.g. topped at 100%). Detect a
    // flat % window so the popover can swap to a livelier temperature series instead.
    var sparkIsFlat: Bool {
        let pcts = chartData.map(\.pct)
        guard let lo = pcts.min(), let hi = pcts.max() else { return false }
        return hi - lo < 2
    }

    // Valid temperature points for that swap (drop the 0.0 failed-ioreg-read sentinels).
    var sparkTemps: [TelemetryPoint] { chartData.filter { ($0.tempC ?? 0) > 0 } }

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

    // Menu bar glyph: DISTINCT from macOS's battery icon on purpose. In the Live style, while the
    // battery is flat it shows the current rotating vital's glyph (heart / thermometer / cycle).
    // Otherwise, while actively cycling it marks FLOW DIRECTION (bolt = in, down-arrow = draining,
    // cycle-arrows = steady). Paused or engine-off keeps the pause circle; an unreachable server
    // shows a warning triangle. Never a second battery/percent.
    func menuBarSymbol(for style: LabelStyle) -> String {
        guard reachable else { return "exclamationmark.triangle" }
        if style == .live, isFlatFlow, let v = currentVital { return v.symbol }
        if !engineLoaded { return "pause.circle" }
        // A real charge/drain wins over the paused glyph: in Normal mode the engine is paused but
        // macOS still trickle-charges, so mark the true flow direction, never a "paused" glyph
        // next to a live "IN/OUT" watts readout. isFlatFlow already treats a sub-1W charging
        // trickle as flat, so only a genuine flow trips the bolt/arrow.
        if !isFlatFlow { return flow == .draining ? "arrow.down.circle" : "bolt.fill" }
        if status?.paused == true { return "pause.circle" }
        return "arrow.triangle.2.circlepath"
    }

    // The menu bar value text. The signed watts / time already carry direction (plus the leading
    // glyph), so there is no IN/OUT prefix to strip.
    func menuBarValue(for style: LabelStyle) -> String? {
        return menuLabel(for: style)
    }

    // VoiceOver description for the menu bar item: describe what is ACTUALLY shown for this style,
    // not always the rotating vital (currentVital), which is only on screen in .live while flat.
    // Previously the label always announced the vital, so "Power (W)" draining at 18.8W spoke "Cycles".
    func menuBarAccessibility(for style: LabelStyle) -> String {
        guard reachable else { return "BattCal: server offline" }
        if style == .live, isFlatFlow, let v = currentVital { return "BattCal: \(v.label), \(v.text)" }
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

    // Menu bar text (no glyph unless the style is iconOnly). When not cycling
    // we show the mode word, not a redundant % (Apple's own icon shows that).
    func menuLabel(for style: LabelStyle) -> String? {
        if style == .iconOnly { return nil }
        guard reachable else { return "--" }
        if activeMode == .off { return "off" }      // engine stopped: nothing live to show
        switch style {
        case .iconOnly: return nil
        // Signed watts + time-left while cycling; rotate vitals while flat (never a dead 0.0W).
        case .live:    return isFlatFlow ? (currentVital?.text ?? titleText) : (wattsPlusTime ?? titleText)
        // Signed watts only while cycling; rotate vitals while flat.
        case .power:   return isFlatFlow ? (currentVital?.text ?? titleText) : (signedWatts ?? titleText)
        // Time-left (H:MM) while cycling; rotate vitals while flat.
        case .eta:     return isFlatFlow ? (currentVital?.text ?? titleText) : (timeLeftText ?? signedWatts ?? titleText)
        case .percent: return titleText
        case .health:  return status?.rawHealthPct.map { String(format: "%.1f%%", $0) } ?? titleText
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
