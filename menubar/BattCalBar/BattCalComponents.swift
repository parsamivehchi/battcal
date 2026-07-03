import SwiftUI
import Charts

// Reusable pieces shared by the menu-bar popover (PopoverView) and the standalone
// window (MainWindowView), so both surfaces stay in sync and each view stays focused.

// Live battery-% chart. Short in the popover, tall in the window.
struct LiveChart: View {
    let spark: [TelemetryPoint]
    var height: CGFloat = 56
    var body: some View {
        Chart(spark) {
            LineMark(x: .value("Time", $0.date), y: .value("%", $0.pct))
                .lineStyle(StrokeStyle(lineWidth: 2))
                .interpolationMethod(.monotone)
            AreaMark(x: .value("Time", $0.date), y: .value("%", $0.pct))
                .opacity(0.12)
        }
        .chartYScale(domain: 0...100)
        .chartXAxis(.hidden)
        .chartYAxis {
            AxisMarks(values: [0, 50, 100]) {
                AxisGridLine()
                AxisValueLabel().font(.system(size: 8))
            }
        }
        .frame(height: height)
    }
}

// A labelled progress meter (charge / health) with an optional reference marker
// (e.g. the 80% AppleCare line on the health bar).
struct MeterBar: View {
    let label: String
    let valueText: String
    let fraction: Double        // 0...1
    var tint: Color = .green
    var marker: Double? = nil   // 0...1 position of a reference line
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(label).font(.subheadline.weight(.semibold))
                Spacer()
                Text(valueText).font(.subheadline.weight(.semibold)).monospacedDigit()
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 5).fill(Color.primary.opacity(0.10))
                    RoundedRectangle(cornerRadius: 5).fill(tint)
                        .frame(width: max(0, min(1, fraction)) * geo.size.width)
                    if let m = marker {
                        Rectangle().fill(Color.red.opacity(0.75)).frame(width: 1.5)
                            .offset(x: max(0, min(1, m)) * geo.size.width - 0.75)
                    }
                }
            }
            .frame(height: 10)
        }
    }
}

// The three-mode selector (Longevity / Calibration / Normal). Active row is filled
// with the mode color plus a checkmark; tap an inactive row to switch.
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
        .background(RoundedRectangle(cornerRadius: 9).fill(active ? tint.opacity(0.16) : Color.primary.opacity(0.05)))
        .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(active ? tint.opacity(0.7) : Color.clear, lineWidth: 1.5))
        .disabled(!model.reachable)
        .opacity(model.reachable ? 1 : 0.5)
    }
}

// The throttle / benchmark-break banner. Pass a ticking clock so the break countdown
// updates smoothly. Renders nothing when neither condition applies.
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
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: icon).foregroundStyle(tint).font(.system(size: 14, weight: .semibold))
                Text(title).font(.callout.weight(.semibold))
                Spacer()
            }
            Text(message).font(.caption).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: action) {
                Text(actionTitle).font(.caption.weight(.semibold))
                    .frame(maxWidth: .infinity).padding(.vertical, 6)
                    .background(tint.opacity(0.9), in: RoundedRectangle(cornerRadius: 7))
                    .foregroundStyle(.white)
            }
            .buttonStyle(.plain)
            .disabled(!model.reachable)
            .opacity(model.reachable ? 1 : 0.5)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10).fill(tint.opacity(0.12)))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(tint.opacity(0.35), lineWidth: 1))
    }
}
