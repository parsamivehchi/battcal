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
    // Phase-1 de-risk debug file: lets us confirm the read from outside the app. (Path is transform-
    // safe: deploy.sh only rewrites the "/var/tmp/battcal." prefix, not "battcal-".)
    private let debugFile = "/var/tmp/battcal-wifi.ssid"

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

    func read() {
        let s = cw.interface()?.ssid()
        if s != ssid { ssid = s }
        // Phase-1 verification breadcrumb: SSID + unix timestamp.
        let line = "\(s ?? "")\n\(Int(Date().timeIntervalSince1970))\nauth=\(auth.rawValue)\n"
        try? line.write(toFile: debugFile, atomically: true, encoding: .utf8)
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
