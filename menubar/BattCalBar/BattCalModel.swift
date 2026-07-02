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
    var mode: String
    var band: Band
    var pct: Int?
    var charging: Bool
    var plugged: Bool
    var adapterW: Int
    var batteryW: Double?
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
    func setMode(_ m: String) {
        Task {
            var req = URLRequest(url: URL(string: "api/mode?mode=\(m)", relativeTo: base)!)
            req.httpMethod = "POST"
            _ = try? await URLSession.shared.data(for: req)
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

    // Menu bar glyph: battery level + state overlays.
    var symbolName: String {
        guard reachable, let s = status, let pct = s.pct else { return "battery.slash" }
        if !engineLoaded { return "battery.100percent" }
        if s.paused { return "pause.circle" }
        if s.charging || s.state == "charge" { return "battery.100percent.bolt" }
        switch pct {
        case ..<13: return "battery.0percent"
        case ..<38: return "battery.25percent"
        case ..<63: return "battery.50percent"
        case ..<88: return "battery.75percent"
        default: return "battery.100percent"
        }
    }

    var titleText: String {
        guard reachable, let pct = status?.pct else { return "--" }
        return "\(pct)%"
    }

    // Estimated minutes until the battery reaches the active band edge,
    // from the last ~15 minutes of telemetry slope. nil = not estimable.
    var minutesToTarget: (mins: Int, target: Int)? {
        guard reachable, engineLoaded, let s = status, let pct = s.pct, !s.paused else { return nil }
        let target = s.state == "drain" ? s.band.low : s.band.high
        let recent = spark.suffix(30)
        guard recent.count >= 4, let first = recent.first, let last = recent.last else { return nil }
        let dtMin = last.date.timeIntervalSince(first.date) / 60
        let dPct = last.pct - first.pct
        guard dtMin > 2, abs(dPct) > 0.2 else { return nil }
        let rate = dPct / dtMin
        let mins = (Double(target) - Double(pct)) / rate
        guard mins > 0, mins < 48 * 60 else { return nil }
        return (Int(mins), target)
    }

    var etaText: String? {
        guard let (mins, target) = minutesToTarget else { return nil }
        let t = mins >= 60 ? "\(mins / 60)h\(String(format: "%02d", mins % 60))" : "\(mins)m"
        return "\(t)→\(target)%"
    }

    func labelText(for style: LabelStyle) -> String? {
        guard reachable, let s = status else { return style == .iconOnly ? nil : "--" }
        switch style {
        case .iconOnly: return nil
        case .percent: return titleText
        case .eta: return etaText ?? titleText
        case .power:
            guard let w = s.batteryW else { return titleText }
            return String(format: "%+.1fW", w)
        case .health:
            guard let h = s.rawHealthPct else { return titleText }
            return String(format: "%.1f%%", h)
        }
    }

    var stateLine: String {
        guard reachable else { return "BattCal server offline" }
        guard let s = status else { return "Reading battery…" }
        if !engineLoaded { return "Engine off - charging like normal" }
        if s.paused { return "Paused - charging like normal" }
        switch s.state {
        case "drain": return "Draining to \(s.band.low)%"
        case "charge": return "Charging to \(s.band.high)%"
        case "hold": return "Holding at full (calibration)"
        default: return s.state
        }
    }

    var stateColor: Color {
        guard reachable, let s = status, engineLoaded else { return .secondary }
        if s.paused { return .blue }
        switch s.state {
        case "drain": return .orange
        case "charge", "hold": return .green
        default: return .secondary
        }
    }
}
