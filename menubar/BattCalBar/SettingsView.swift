import SwiftUI
import AppKit
import ServiceManagement

// The app's Settings window - a System Settings style shell: an icon-chip sidebar on the left and
// a detail pane on the right, hosted in the AppDelegate-owned NSWindow (popover gear, app menu,
// Cmd-comma all route here). Typography and card grammar match the popover: uppercase eyebrow
// section labels, semibold values, tinted rounded icon chips, soft grouped cards.

// MARK: - Panes

private enum SettingsPane: String, CaseIterable, Identifiable {
    case general, homeCycling, about
    var id: String { rawValue }
    var title: String {
        switch self {
        case .general: return "General"
        case .homeCycling: return "Home Cycling"
        case .about: return "About"
        }
    }
    var symbol: String {
        switch self {
        case .general: return "gearshape.fill"
        case .homeCycling: return "house.fill"
        case .about: return "info.circle.fill"
        }
    }
    var tint: Color {
        switch self {
        case .general: return .gray
        case .homeCycling: return .green
        case .about: return .blue
        }
    }
}

// MARK: - Shell

struct SettingsView: View {
    @ObservedObject var model: BattCalModel
    @ObservedObject var wifi: WiFiMonitor
    @State private var pane: SettingsPane = .general

    var body: some View {
        HStack(spacing: 0) {
            sidebar
            Divider()
            detail
        }
        .frame(width: 660, height: 520)
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(SettingsPane.allCases) { p in
                SidebarRow(pane: p, selected: pane == p) { pane = p }
            }
            Spacer()
        }
        .padding(10)
        .frame(width: 185)
        .background(Color.primary.opacity(0.04))
    }

    private var detail: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if pane != .about {
                    Text(pane.title)
                        .font(.system(size: 22, weight: .bold))
                }
                switch pane {
                case .general: GeneralPane()
                case .homeCycling: HomeCyclingPane(wifi: wifi)
                case .about: AboutPane(model: model)
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct SidebarRow: View {
    let pane: SettingsPane
    let selected: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) {
                IconChip(symbol: pane.symbol, tint: pane.tint, size: 26)
                Text(pane.title)
                    .font(.system(size: 13.5, weight: .medium))
                    .foregroundStyle(selected ? Color.white : .primary)
                Spacer(minLength: 0)
            }
            .padding(.vertical, 5)
            .padding(.horizontal, 7)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(selected ? Color.accentColor : .clear)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Shared building blocks

// Uppercase eyebrow section label (the popover's "MODE" grammar, sized up for a window).
private struct Eyebrow: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .bold))
            .kerning(0.7)
            .foregroundStyle(.secondary)
    }
}

// A grouped settings card: soft fill + hairline stroke, comfortable padding.
private struct SettingsCard<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.primary.opacity(0.045))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.07), lineWidth: 1)
            )
    }
}

// Tinted rounded-square chip with a white SF Symbol, System Settings style.
private struct IconChip: View {
    let symbol: String
    let tint: Color
    var size: CGFloat = 28
    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
            .fill(tint.gradient)
            .frame(width: size, height: size)
            .overlay(
                Image(systemName: symbol)
                    .font(.system(size: size * 0.48, weight: .semibold))
                    .foregroundStyle(.white)
            )
    }
}

// A standard settings row: icon chip + bold title / secondary subtitle + trailing control.
private struct SettingRow<Trailing: View>: View {
    let symbol: String
    let tint: Color
    let title: String
    var subtitle: String? = nil
    @ViewBuilder var trailing: Trailing
    var body: some View {
        HStack(spacing: 11) {
            IconChip(symbol: symbol, tint: tint)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 13.5, weight: .semibold))
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 11.5))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 12)
            trailing
        }
    }
}

// Small capsule status badge (HOME / AWAY / CONNECTED).
private struct StatusBadge: View {
    let text: String
    let tint: Color
    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .bold))
            .kerning(0.5)
            .foregroundStyle(tint)
            .padding(.vertical, 3)
            .padding(.horizontal, 8)
            .background(Capsule().fill(tint.opacity(0.15)))
    }
}

// MARK: - General

private struct GeneralPane: View {
    @AppStorage("menuLabelStyle") private var labelStyleRaw = LabelStyle.iconOnly.rawValue
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 8) {
                Eyebrow("Menu bar")
                SettingsCard {
                    SettingRow(symbol: "menubar.rectangle", tint: .indigo,
                               title: "Menu bar display",
                               subtitle: "Right-click the menu bar icon to cycle through these anytime.") {
                        Picker("", selection: $labelStyleRaw) {
                            ForEach(LabelStyle.allCases) { Text($0.title).tag($0.rawValue) }
                        }
                        .labelsHidden()
                        .fixedSize()
                    }
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                Eyebrow("Startup")
                SettingsCard {
                    SettingRow(symbol: "power", tint: .orange,
                               title: "Launch BattCal at login",
                               subtitle: "Keep the menu bar readout available after a restart.") {
                        Toggle("", isOn: $launchAtLogin)
                            .labelsHidden()
                            .toggleStyle(.switch)
                            .onChange(of: launchAtLogin) { _, on in
                                do {
                                    if on { try SMAppService.mainApp.register() }
                                    else { try SMAppService.mainApp.unregister() }
                                } catch { launchAtLogin = SMAppService.mainApp.status == .enabled }
                            }
                    }
                }
            }
        }
        .onAppear { launchAtLogin = SMAppService.mainApp.status == .enabled }
    }
}

// MARK: - Home Cycling

private struct HomeCyclingPane: View {
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
        VStack(alignment: .leading, spacing: 18) {
            SettingsCard {
                SettingRow(symbol: "house.fill", tint: .green,
                           title: "Only cycle at home",
                           subtitle: "Away from your home networks, BattCal charges normally to 100% and never drains. Cycling only ever runs while plugged in.") {
                    Toggle("", isOn: $gateEnabled)
                        .labelsHidden()
                        .toggleStyle(.switch)
                        .onChange(of: gateEnabled) { _, _ in wifi.configChanged() }
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Eyebrow("Current network")
                SettingsCard {
                    HStack(spacing: 11) {
                        IconChip(symbol: statusSymbol, tint: statusColor, size: 32)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(currentTitle).font(.system(size: 15, weight: .semibold))
                            Text(currentDetail)
                                .font(.system(size: 11.5))
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 12)
                        if !wifi.authorized {
                            Button("Grant Access") { wifi.requestAuth() }
                        } else if let s = wifi.ssid, !s.isEmpty {
                            if !ssids.contains(s) {
                                Button("Add as home") { add(s) }
                            }
                            if gateEnabled {
                                StatusBadge(text: wifi.atHome ? "HOME" : "AWAY",
                                            tint: wifi.atHome ? .green : .orange)
                            }
                        }
                    }
                    if wifi.auth == .denied || wifi.auth == .restricted {
                        HStack(spacing: 6) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .font(.system(size: 11)).foregroundStyle(.orange)
                            Text("Location is denied. BattCal needs it only to read the Wi-Fi network name.")
                                .font(.system(size: 11.5)).foregroundStyle(.secondary)
                            Spacer()
                            Button("Open Settings") { wifi.openLocationSettings() }.controlSize(.small)
                        }
                    }
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Eyebrow("Home networks")
                SettingsCard {
                    if ssids.isEmpty {
                        HStack(spacing: 8) {
                            Image(systemName: "wifi.slash").foregroundStyle(.secondary)
                            Text("No home networks yet - with the gate on, cycling stays off everywhere until you add one.")
                                .font(.system(size: 11.5)).foregroundStyle(.secondary)
                        }
                    }
                    ForEach(ssids, id: \.self) { s in
                        HStack(spacing: 11) {
                            IconChip(symbol: "wifi", tint: .blue, size: 26)
                            Text(s).font(.system(size: 13.5, weight: .semibold))
                            if s == wifi.ssid {
                                StatusBadge(text: "CONNECTED", tint: .green)
                            }
                            Spacer()
                            Button(role: .destructive) { remove(s) } label: {
                                Image(systemName: "minus.circle.fill").font(.system(size: 16))
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(.red.opacity(0.85))
                            .help("Remove \(s)")
                        }
                        if s != ssids.last { Divider() }
                    }
                    HStack(spacing: 8) {
                        TextField("Add a network name (SSID)", text: $newSSID)
                            .textFieldStyle(.roundedBorder)
                            .onSubmit { add(newSSID) }
                        Button("Add") { add(newSSID) }
                            .buttonStyle(.borderedProminent)
                            .disabled(newSSID.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
                // Match the old behavior: only the editable list dims when the gate is off;
                // the current-network card stays interactive (Grant Access / Add as home).
                .disabled(!gateEnabled)
                .opacity(gateEnabled ? 1 : 0.5)
            }

            HStack(alignment: .top, spacing: 9) {
                Image(systemName: "info.circle.fill")
                    .font(.system(size: 13)).foregroundStyle(.blue)
                Text("BattCal reads the Wi-Fi name every few minutes. If the signal is missing, stale, or the network is unknown, it plays it safe: cycling suspends and the battery charges normally.")
                    .font(.system(size: 11.5)).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.blue.opacity(0.07)))
        }
    }

    private var statusSymbol: String {
        if !wifi.authorized { return "wifi.slash" }
        return wifi.atHome ? "wifi" : "wifi.exclamationmark"
    }
    private var statusColor: Color {
        if !wifi.authorized { return .gray }
        return wifi.atHome ? .green : .orange
    }
    private var currentTitle: String {
        if !wifi.authorized { return "Location access needed" }
        guard let s = wifi.ssid, !s.isEmpty else { return "Not connected to Wi-Fi" }
        return s
    }
    private var currentDetail: String {
        if !wifi.authorized { return "Grant location access so BattCal can read the network name." }
        if (wifi.ssid ?? "").isEmpty { return "Treated as away - charging normally." }
        if !gateEnabled { return "Home gate is off - cycling runs on any network." }
        // The GATE, not activity: cycling may still be paused or holding while at home.
        return wifi.atHome ? "Home network - cycling allowed here." : "Away - charging normally to 100%."
    }
}

// MARK: - About

private struct AboutPane: View {
    @ObservedObject var model: BattCalModel
    private var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
    }
    var body: some View {
        VStack(spacing: 10) {
            Spacer(minLength: 12)
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .frame(width: 84, height: 84)
            Text("BattCal").font(.system(size: 26, weight: .bold))
            Text("Version \(version)").font(.system(size: 13)).foregroundStyle(.secondary)
            Text("Battery band cycler for Apple Silicon MacBooks.")
                .font(.system(size: 13)).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            if let h = model.status?.rawHealthPct, let c = model.status?.cycles {
                HStack(spacing: 12) {
                    aboutStat("True health", String(format: "%.1f%%", h))
                    aboutStat("Cycles", "\(c)")
                }
                .padding(.top, 8)
            }
            Link("github.com/parsamivehchi/battcal",
                 destination: URL(string: "https://github.com/parsamivehchi/battcal")!)
                .font(.system(size: 13, weight: .medium))
                .padding(.top, 8)
            Text("MIT \u{00B7} Parsa Mivehchi").font(.system(size: 11)).foregroundStyle(.tertiary)
            Spacer(minLength: 12)
        }
        .frame(maxWidth: .infinity)
    }

    private func aboutStat(_ label: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .bold)).kerning(0.5).foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 17, weight: .semibold)).monospacedDigit()
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 16)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.primary.opacity(0.045)))
    }
}
