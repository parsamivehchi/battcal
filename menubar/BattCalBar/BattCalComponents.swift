import SwiftUI
import Charts
import AppKit

// Native window vibrancy (NSVisualEffectView) so the window is translucent like the menu
// bar popover - the desktop shows through behind the content.
struct VisualEffectView: NSViewRepresentable {
    var material: NSVisualEffectView.Material = .hudWindow
    var blending: NSVisualEffectView.BlendingMode = .behindWindow
    func makeNSView(context: Context) -> NSVisualEffectView {
        let v = NSVisualEffectView()
        v.material = material
        v.blendingMode = blending
        v.state = .active
        return v
    }
    func updateNSView(_ v: NSVisualEffectView, context: Context) {
        v.material = material
        v.blendingMode = blending
    }
}

// Reusable pieces shared by the menu-bar popover (PopoverView) and the standalone
// window (MainWindowView). The window adopts Liquid Glass (macOS 26+) with a material
// fallback on older systems, so call sites stay clean and OSS-safe.

extension View {
    // Liquid Glass surface with a material fallback. Apply AFTER layout/appearance modifiers.
    @ViewBuilder func glassCard(tint: Color? = nil, cornerRadius: CGFloat = 16) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        if #available(macOS 26.0, *) {
            let glass: Glass = tint != nil ? .regular.tint(tint!.opacity(0.28)) : .regular
            self.glassEffect(glass, in: shape)
        } else {
            self.background(.ultraThinMaterial, in: shape)
                .overlay(shape.strokeBorder(Color.primary.opacity(0.08), lineWidth: 1))
        }
    }
    // Liquid Glass button style, with native bordered fallback on older systems.
    @ViewBuilder func glassButtonStyle(prominent: Bool = false, tint: Color = .accentColor) -> some View {
        if #available(macOS 26.0, *) {
            if prominent { self.buttonStyle(.glassProminent).tint(tint) }
            else { self.buttonStyle(.glass).tint(tint) }
        } else {
            if prominent { self.buttonStyle(.borderedProminent).tint(tint) }
            else { self.buttonStyle(.bordered).tint(tint) }
        }
    }
}

// Wraps grouped glass surfaces so they blend and morph (macOS 26); passthrough otherwise.
struct GlassStack<Content: View>: View {
    var spacing: CGFloat = 14
    @ViewBuilder var content: Content
    var body: some View {
        if #available(macOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) { content }
        } else {
            content
        }
    }
}

// A grouped glass card container for the window sections.
struct GlassCard<Content: View>: View {
    var tint: Color? = nil
    var padding: CGFloat = 13
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassCard(tint: tint)
    }
}

// A small section caption used above grouped content.
struct SectionLabel: View {
    let text: String
    var body: some View {
        Text(text).font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary).tracking(0.5)
    }
}

// A full-width tinted-fill action button for use INSIDE glass cards / banners (a solid
// control on glass, never glass-on-glass). Standalone primary buttons use glassButtonStyle.
struct GlassActionButton: View {
    let title: String
    let icon: String
    var tint: Color = .accentColor
    var enabled: Bool = true
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon).frame(width: 18)
                Text(title).fontWeight(.semibold)
                Spacer(minLength: 6)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 7).padding(.horizontal, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(tint.opacity(0.16), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(tint.opacity(0.35), lineWidth: 1))
        .foregroundStyle(tint)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.5)
    }
}

// Live sparkline with a soft gradient fill. Plots battery % by default; when the % window is flat
// (topped up / holding) the popover swaps to a temperature series so the chart stays informative.
struct LiveChart: View {
    enum Mode { case pct, temp }
    let spark: [TelemetryPoint]
    var height: CGFloat = 56
    var mode: Mode = .pct
    var live: Bool = false   // true when fed by the live status buffer (paused), not the 3h telemetry window

    private func y(_ p: TelemetryPoint) -> Double { (mode == .temp ? p.tempC : p.pct) ?? 0 }

    private var yDomain: ClosedRange<Double> {
        guard mode == .temp else { return 0...100 }
        let ys = spark.compactMap { $0.tempC }.filter { $0 > 0 }
        guard let lo = ys.min(), let hi = ys.max() else { return 20...40 }
        // Pad, with a minimum span so a nearly-flat idle temp reads as a band, not a hairline.
        let span = max(hi - lo, 5), mid = (lo + hi) / 2
        return (mid - span / 2 - 1)...(mid + span / 2 + 1)
    }

    private var yTicks: [Double] {
        guard mode == .temp else { return [0, 50, 100] }
        let d = yDomain
        return [d.lowerBound, (d.lowerBound + d.upperBound) / 2, d.upperBound].map { $0.rounded() }
    }

    var body: some View {
        Chart(spark) { p in
            AreaMark(x: .value("Time", p.date), y: .value("v", y(p)))
                .interpolationMethod(.monotone)
                .foregroundStyle(LinearGradient(
                    colors: [Color.accentColor.opacity(0.35), Color.accentColor.opacity(0.03)],
                    startPoint: .top, endPoint: .bottom))
            LineMark(x: .value("Time", p.date), y: .value("v", y(p)))
                .interpolationMethod(.monotone)
                .foregroundStyle(Color.accentColor)
                .lineStyle(StrokeStyle(lineWidth: 2))
        }
        .chartYScale(domain: yDomain)
        .chartXAxis(.hidden)
        .chartYAxis {
            AxisMarks(values: yTicks) {
                AxisGridLine().foregroundStyle(Color.primary.opacity(0.08))
                AxisValueLabel().font(.system(size: 8)).foregroundStyle(.secondary)
            }
        }
        .frame(height: height)
        .overlay(alignment: .topLeading) {
            if mode == .temp {
                Text(live ? "Temp \u{00B7} live" : "Temp \u{00B7} last 3h")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .padding(.leading, 2)
            }
        }
    }
}

// A labelled gradient progress meter (charge / health) with an optional reference marker.
struct MeterBar: View {
    let label: String
    let valueText: String
    let fraction: Double        // 0...1
    var tint: Color = .green
    var marker: Double? = nil   // 0...1 position of a reference line
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(label).font(.footnote.weight(.semibold))
                Spacer()
                Text(valueText).font(.footnote.weight(.bold)).monospacedDigit()
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.primary.opacity(0.12))
                    Capsule()
                        .fill(LinearGradient(colors: [tint.opacity(0.75), tint], startPoint: .leading, endPoint: .trailing))
                        .frame(width: max(6, min(1, fraction) * geo.size.width))
                    if let m = marker {
                        Rectangle().fill(Color.white.opacity(0.9)).frame(width: 2)
                            .offset(x: max(0, min(1, m)) * geo.size.width - 1)
                    }
                }
            }
            .frame(height: 9)
        }
    }
}

// The three-mode selector (Longevity / Calibration / Normal).
struct ModeSelector: View {
    @ObservedObject var model: BattCalModel
    var body: some View {
        VStack(spacing: 6) {
            row(.longevity, "arrow.triangle.2.circlepath", "Longevity", "Cycle 10-90%, never sits at full", .green)
            row(.calibration, "gauge.with.needle", "Calibration", "Full 5-100% passes, re-learns health", .orange)
            row(.normal, "bolt.fill", "Normal charging", "Apple's default: charges to 100%", .blue)
        }
    }
    private func row(_ mode: BattCalModel.ActiveMode, _ icon: String, _ title: String, _ subtitle: String, _ tint: Color) -> some View {
        let active = model.activeMode == mode
        return Button { model.select(mode) } label: {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(active ? tint : .secondary)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.callout.weight(.semibold)).foregroundStyle(.primary)
                    Text(subtitle).font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
                if active { Image(systemName: "checkmark.circle.fill").foregroundStyle(tint) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.vertical, 7).padding(.horizontal, 10)
        .background(RoundedRectangle(cornerRadius: 9).fill(active ? tint.opacity(0.18) : Color.primary.opacity(0.06)))
        .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(active ? tint.opacity(0.7) : Color.clear, lineWidth: 1.5))
        .disabled(!model.reachable)
        .opacity(model.reachable ? 1 : 0.5)
    }
}

// The throttle / benchmark-break banner as a tinted glass surface. Pass a ticking clock.
struct PowerBanner: View {
    @ObservedObject var model: BattCalModel
    let now: Date
    var body: some View {
        if let remaining = model.breakRemaining(asOf: now) {
            banner(tint: .blue, icon: "bolt.fill",
                   title: "Benchmark break active",
                   message: "Full speed now. Resumes calibration in \(fmt(remaining)). Run Geekbench.",
                   actionTitle: "Resume calibration now") { model.resume() }
        } else if model.isDischarging {
            let onBattery = model.status?.plugged != true
            banner(tint: .orange, icon: "exclamationmark.triangle.fill",
                   title: "CPU is power-throttled",
                   message: onBattery
                       ? "On battery. CPU-heavy benchmarks score lower than plugged in, and worse as the battery drops."
                       : "BattCal is draining (adapter cut), so the Mac runs on battery. Benchmarks and heavy compute score low, and worse as % drops.",
                   actionTitle: "Benchmark break (30 min)") { model.benchmarkBreak(minutes: 30) }
        }
    }
    private func fmt(_ secs: Int) -> String { String(format: "%d:%02d", secs / 60, secs % 60) }
    private func banner(tint: Color, icon: String, title: String, message: String,
                        actionTitle: String, action: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: icon).foregroundStyle(tint).font(.system(size: 14, weight: .semibold))
                Text(title).font(.callout.weight(.semibold))
                Spacer()
            }
            Text(message).font(.caption).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            GlassActionButton(title: actionTitle, icon: "speedometer", tint: tint, action: action)
        }
        .padding(12)
        .glassCard(tint: tint)
    }
}
