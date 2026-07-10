import Foundation
import AppKit
import CoreWLAN
import CoreLocation
import Combine

// macOS 14+ gates the Wi-Fi SSID behind Location Services, so this owns a CLLocationManager purely
// to unlock CoreWLAN's ssid() read. It republishes the current SSID + authorization for the UI, and
// (Phase 2) drives the home-only cycling gate. It does NOT track location beyond the Wi-Fi read.
@MainActor
final class WiFiMonitor: NSObject, ObservableObject {
    @Published private(set) var ssid: String?
    @Published private(set) var auth: CLAuthorizationStatus

    private let cw = CWWiFiClient.shared()
    private let loc = CLLocationManager()
    private var timer: Timer?

    // --- Home detection config (edited in Settings; the engine reads the published gate files) ---
    // Ships EMPTY on purpose: users add their own networks in Settings > Home Cycling. With no
    // homes configured, atHome is always false and gated cycling stays off everywhere (fail-safe).
    static let defaultHomeSSIDs = ""
    // The current SSID, for outside-the-app verification (transform-safe path: deploy.sh only rewrites
    // the "/var/tmp/battcal." prefix, not "battcal-").
    private let ssidFile = "/var/tmp/battcal-wifi.ssid"
    // Live gate the engine consumes: "1|0 <unix ts>" (freshness-guarded engine-side).
    private let gateStatusFile = "/var/tmp/battcal-athome"
    // Persistent opt-in flag (survives reboot); the engine only gates cycling when this exists.
    private let gateEnabledFlag = ("~/.battcal/homegate.on" as NSString).expandingTildeInPath

    var homeSSIDs: [String] {
        // Canonical storage is a string ARRAY (an SSID may legally contain a comma). The legacy
        // comma-joined "homeSSIDs" string is migrated to "homeSSIDList" at launch; the fallback
        // read keeps the first poll correct even before that migration runs.
        if let list = UserDefaults.standard.stringArray(forKey: "homeSSIDList") {
            return list.filter { !$0.isEmpty }
        }
        return (UserDefaults.standard.string(forKey: "homeSSIDs") ?? Self.defaultHomeSSIDs)
            .split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }
    var homeGateEnabled: Bool { UserDefaults.standard.object(forKey: "homeGateEnabled") as? Bool ?? true }

    // Cycling allowed? Gate off => always. Gate on => the current SSID must be a known home network;
    // an unknown network or an unread SSID counts as AWAY (fail-safe: never cycle unless confirmed home).
    var atHome: Bool {
        guard homeGateEnabled else { return true }
        guard let s = ssid, !s.isEmpty else { return false }
        return homeSSIDs.contains(s)
    }

    override init() {
        ssid = nil
        auth = .notDetermined
        super.init()
        loc.delegate = self
        auth = loc.authorizationStatus
        if auth == .notDetermined { loc.requestWhenInUseAuthorization() }
        cw.delegate = self
        try? cw.startMonitoringEvent(with: .ssidDidChange)
        read()
        timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.read() }
        }
    }

    deinit { timer?.invalidate() }

    // Ask for Location again (used by a "Grant access" button when the user deferred the prompt).
    func requestAuth() { loc.requestWhenInUseAuthorization() }

    // Open System Settings > Privacy > Location Services when the user has denied and must re-enable.
    func openLocationSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices") {
            NSWorkspace.shared.open(url)
        }
    }

    var authorized: Bool { auth == .authorized || auth == .authorizedAlways }

    // Dedup keys so the 15 s poll does not hit the disk when nothing changed.
    private var lastSSIDWritten: String?
    private var lastGateValue: Bool?

    func read() {
        let s = cw.interface()?.ssid()
        if s != ssid { ssid = s }
        // SSID breadcrumb (outside-the-app verification; nothing checks its freshness): only
        // rewrite when the network or auth state actually changes, so mtime marks the change.
        let key = "\(s ?? "")|\(auth.rawValue)"
        if key != lastSSIDWritten {
            let line = "\(s ?? "")\n\(Int(Date().timeIntervalSince1970))\nauth=\(auth.rawValue)\n"
            try? line.write(toFile: ssidFile, atomically: true, encoding: .utf8)
            lastSSIDWritten = key
        }
        publishGate()
        // No unconditional objectWillChange here: @Published ssid/auth cover live changes, and
        // configChanged() publishes explicitly for home-list / gate-toggle edits.
    }

    // Call after the user edits home config in Settings so the gate files + UI update immediately.
    // The config lives in plain UserDefaults (invisible to @Published), so publish explicitly.
    func configChanged() {
        objectWillChange.send()
        read()
    }

    // Publish the home gate for the engine: a persistent opt-in flag + a live at-home status line.
    private func publishGate() {
        let fm = FileManager.default
        if homeGateEnabled {
            try? fm.createDirectory(atPath: (gateEnabledFlag as NSString).deletingLastPathComponent,
                                    withIntermediateDirectories: true)
            if !fm.fileExists(atPath: gateEnabledFlag) { fm.createFile(atPath: gateEnabledFlag, contents: nil) }
        } else if fm.fileExists(atPath: gateEnabledFlag) {
            try? fm.removeItem(atPath: gateEnabledFlag)
        }
        // The engine fail-safes to AWAY when this file's MTIME is older than ATHOME_MAX_AGE=90 s
        // (bin/battcal-engine.sh home_ok), so the write can NEVER be skipped outright on an
        // unchanged value: rewrite when the value flips OR the mtime age passes 60 s (a safe
        // margin under 90 at the 15 s poll). Steady-state disk writes drop from 4/min to 1/min.
        let home = atHome
        let mtime = (try? fm.attributesOfItem(atPath: gateStatusFile))?[.modificationDate] as? Date
        let age = mtime.map { Date().timeIntervalSince($0) } ?? .infinity
        guard home != lastGateValue || age > 60 else { return }
        lastGateValue = home
        let gate = "\(home ? 1 : 0)\n\(Int(Date().timeIntervalSince1970))\n"
        try? gate.write(toFile: gateStatusFile, atomically: true, encoding: .utf8)
    }
}

extension WiFiMonitor: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            self.auth = manager.authorizationStatus
            self.read()
        }
    }
}

extension WiFiMonitor: CWEventDelegate {
    nonisolated func ssidDidChangeForWiFiInterface(withName interfaceName: String) {
        Task { @MainActor in self.read() }
    }
}
