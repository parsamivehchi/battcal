import SwiftUI
import ServiceManagement

// The app's Settings window (Cmd-, or the popover gear). A standard macOS tabbed Settings scene:
// General (display + login), Home Cycling (the home-only gate + Wi-Fi list), and About.
struct SettingsView: View {
    @ObservedObject var model: BattCalModel
    @ObservedObject var wifi: WiFiMonitor

    var body: some View {
        TabView {
            GeneralSettingsTab()
                .tabItem { Label("General", systemImage: "gearshape") }
            HomeCyclingTab(wifi: wifi)
                .tabItem { Label("Home Cycling", systemImage: "house") }
            AboutTab(model: model)
                .tabItem { Label("About", systemImage: "info.circle") }
        }
        .frame(width: 500, height: 400)
    }
}

// MARK: - General

private struct GeneralSettingsTab: View {
    @AppStorage("menuLabelStyle") private var labelStyleRaw = LabelStyle.iconOnly.rawValue
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled

    var body: some View {
        Form {
            Section("Menu bar") {
                Picker("Show", selection: $labelStyleRaw) {
                    ForEach(LabelStyle.allCases) { Text($0.title).tag($0.rawValue) }
                }
                Text("Right-click the menu bar icon to cycle through these without opening Settings.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("Startup") {
                Toggle("Launch BattCal at login", isOn: $launchAtLogin)
                    .onChange(of: launchAtLogin) { _, on in
                        do {
                            if on { try SMAppService.mainApp.register() }
                            else { try SMAppService.mainApp.unregister() }
                        } catch { launchAtLogin = SMAppService.mainApp.status == .enabled }
                    }
            }
        }
        .formStyle(.grouped)
        .onAppear { launchAtLogin = SMAppService.mainApp.status == .enabled }
    }
}

// MARK: - Home Cycling

private struct HomeCyclingTab: View {
    @ObservedObject var wifi: WiFiMonitor
    @AppStorage("homeGateEnabled") private var gateEnabled = true
    @AppStorage("homeSSIDs") private var homeSSIDsRaw = WiFiMonitor.defaultHomeSSIDs
    @State private var newSSID = ""

    private var ssids: [String] {
        homeSSIDsRaw.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }
    private func commit(_ list: [String]) {
        homeSSIDsRaw = list.joined(separator: ",")
        wifi.configChanged()
    }
    private func add(_ raw: String) {
        let n = raw.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty, !ssids.contains(n) else { return }
        commit(ssids + [n]); newSSID = ""
    }
    private func remove(_ name: String) { commit(ssids.filter { $0 != name }) }

    var body: some View {
        Form {
            Section {
                Toggle("Only cycle the battery on my home Wi-Fi", isOn: $gateEnabled)
                    .onChange(of: gateEnabled) { _, _ in wifi.configChanged() }
                Text("When you are away from these networks, BattCal charges normally to 100% and never drains - so it never runs in public. Cycling also only ever runs while plugged in.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("Current network") {
                HStack(spacing: 8) {
                    Image(systemName: wifi.authorized ? (wifi.atHome ? "wifi" : "wifi.exclamationmark") : "wifi.slash")
                        .foregroundStyle(statusColor)
                    Text(currentText)
                    Spacer()
                    if !wifi.authorized {
                        Button("Grant Access") { wifi.requestAuth() }
                    } else if let s = wifi.ssid, !s.isEmpty, !ssids.contains(s) {
                        Button("Add as home") { add(s) }
                    }
                }
                if wifi.auth == .denied || wifi.auth == .restricted {
                    HStack {
                        Text("Location is denied. BattCal needs it only to read the Wi-Fi network name.")
                            .font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button("Open Settings") { wifi.openLocationSettings() }.font(.caption)
                    }
                }
            }

            Section("Home networks") {
                if ssids.isEmpty {
                    Text("No home networks yet - with the gate on, cycling stays off everywhere until you add one.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                ForEach(ssids, id: \.self) { s in
                    HStack {
                        Image(systemName: "wifi").foregroundStyle(.secondary)
                        Text(s)
                        Spacer()
                        Button(role: .destructive) { remove(s) } label: {
                            Image(systemName: "minus.circle.fill")
                        }
                        .buttonStyle(.borderless).foregroundStyle(.red)
                    }
                }
                HStack {
                    TextField("Add a network name (SSID)", text: $newSSID)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit { add(newSSID) }
                    Button("Add") { add(newSSID) }
                        .disabled(newSSID.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .disabled(!gateEnabled)
        }
        .formStyle(.grouped)
    }

    private var statusColor: Color {
        if !wifi.authorized { return .secondary }
        return wifi.atHome ? .green : .orange
    }
    private var currentText: String {
        if !wifi.authorized { return "Grant location to read the network name" }
        guard let s = wifi.ssid, !s.isEmpty else { return "Not connected to Wi-Fi - treated as away" }
        if !gateEnabled { return s }
        return wifi.atHome ? "\(s) \u{00B7} home, cycling active" : "\(s) \u{00B7} away, charging normally"
    }
}

// MARK: - About

private struct AboutTab: View {
    @ObservedObject var model: BattCalModel
    private var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
    }
    var body: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "minus.plus.batteryblock.fill")
                .font(.system(size: 52, weight: .semibold))
                .foregroundStyle(.tint)
            Text("BattCal").font(.largeTitle.bold())
            Text("Version \(version)").font(.callout).foregroundStyle(.secondary)
            Text("Battery band cycler for Apple Silicon MacBooks.")
                .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
            if let h = model.status?.rawHealthPct, let c = model.status?.cycles {
                Text(String(format: "True health %.1f%%  \u{00B7}  %d cycles", h, c))
                    .font(.caption).monospacedDigit().foregroundStyle(.secondary)
            }
            Link("github.com/parsamivehchi/battcal",
                 destination: URL(string: "https://github.com/parsamivehchi/battcal")!)
                .font(.callout)
            Text("MIT \u{00B7} Parsa Mivehchi").font(.caption2).foregroundStyle(.tertiary)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }
}
