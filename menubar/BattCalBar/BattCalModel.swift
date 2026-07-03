import Foundation
import SwiftUI

// What the menu bar label shows next to the battery glyph. macOS already has
// its own percent readout, so the smart default is time-to-target.
enum LabelStyle: String, CaseIterable, Identifiable {
    case iconOnly, eta, power, percent, health
    var id: String { rawValue }
    var title: String {
        switch self {
        case .iconOnly: return "Icon only"
        case .eta: return "Time to target"
        case .power: return "Power (W)"
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

    struct Band: Codable { var low: Int; var high: Int }
}

struct TelemetryPoint: Codable, Identifiable {
    var ts: String
    var pct: Double
    var id: String { ts }

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
    @Published var engineLoaded = true
    @Published var reachable = true
    private var ampHistory: [Double] = []

    private let base = URL(string: "http://localhost:4437")!
    private var timer: Timer?
    private let agentLabel = "com.parsa.battery-calibrate"
    private let agentPlist = ("~/Library/LaunchAgents/com.parsa.battery-calibrate.plist" as NSString).expandingTildeInPath

    init() {
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
    }

    func refresh() {
        Task {
            do {
                let (d, _) = try await URLSession.shared.data(from: base.appendingPathComponent("api/status"))
                status = try JSONDecoder().decode(EngineStatus.self, from: d)
                reachable = true
                if let a = status?.amperageMa {
                    ampHistory.append(a)
                    if ampHistory.count > 5 { ampHistory.removeFirst(ampHistory.count - 5) }
                }
            } catch {
                reachable = false
            }
            if let url = URL(string: "api/telemetry?hours=3", relativeTo: base),
               let (d, _) = try? await URLSession.shared.data(from: url),
               let pts = try? JSONDecoder().decode([TelemetryPoint].self, from: d) {
                spark = pts
            }
            engineLoaded = Self.run("/bin/launchctl", ["print", "gui/\(getuid())/\(agentLabel)"]) == 0
        }
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
        if status?.paused == true { return .normal }
        return status?.mode == "calibration" ? .calibration : .longevity
    }

    func select(_ target: ActiveMode) {
        Task {
            if !engineLoaded, target != .off {
                _ = Self.run("/bin/launchctl", ["bootstrap", "gui/\(getuid())", agentPlist])
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

    func turnEngineOff() {
        _ = Self.run("/bin/launchctl", ["bootout", "gui/\(getuid())/\(agentLabel)"])
        _ = Self.run("/opt/homebrew/bin/batt", ["adapter", "enable"])
        refresh()
    }

    func turnEngineOn() {
        _ = Self.run("/bin/launchctl", ["bootstrap", "gui/\(getuid())", agentPlist])
        refresh()
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
        if !engineLoaded { return "battery.100percent" }
        if s.paused { return "pause.circle" }
        if flow == .charging { return "battery.100percent.bolt" }
        switch pct {
        case ..<13: return "battery.0percent"
        case ..<38: return "battery.25percent"
        case ..<63: return "battery.50percent"
        case ..<88: return "battery.75percent"
        default: return "battery.100percent"
        }
    }

    // Menu bar glyph: DISTINCT from macOS's battery icon on purpose. A cycle-arrows glyph
    // marks the item as BattCal (a band cycler), never a second battery/percent readout.
    var menuBarSymbol: String {
        guard reachable else { return "exclamationmark.triangle" }
        if !engineLoaded || status?.paused == true { return "pause.circle" }
        return "arrow.triangle.2.circlepath"
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
        guard reachable else { return "\u{2014}" }
        switch activeMode {
        case .off: return "off"
        case .normal: return "normal"
        case .longevity, .calibration:
            switch style {
            case .iconOnly: return nil
            case .percent: return titleText
            // ETA when we can compute it, else compact watts. NEVER the bare percent
            // (macOS already shows that); nil here makes the menu bar show the glyph alone.
            case .eta: return etaText ?? status?.batteryW.map { String(format: "%+.0fW", $0) }
            case .power: return status?.batteryW.map { String(format: "%+.1fW", $0) } ?? titleText
            case .health: return status?.rawHealthPct.map { String(format: "%.1f%%", $0) } ?? titleText
            }
        }
    }

    var stateLine: String {
        guard reachable else { return "BattCal server offline" }
        guard let s = status else { return "Reading battery…" }
        if !engineLoaded { return "Off \u{2013} charging like normal" }
        if s.paused { return "Normal charging (Apple default)" }
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
