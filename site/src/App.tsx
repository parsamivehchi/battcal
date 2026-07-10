import { Download, ArrowDown } from 'lucide-react';
import { BandGauge } from './BandGauge';
import { ContactForm } from './ContactForm';

// lucide dropped brand icons; the GitHub mark ships inline.
function GithubMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

const BASE = import.meta.env.BASE_URL; // '/battcal/'
const GITHUB = 'https://github.com/parsamivehchi/battcal';
const RELEASES = `${GITHUB}/releases/latest`;

function Section({ id, eyebrow, title, children }: { id?: string; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mx-auto w-full max-w-5xl px-5 py-14 sm:py-20">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="display mt-2 text-3xl sm:text-4xl">{title}</h2>
      <div className="mt-8">{children}</div>
    </section>
  );
}

// MagSafe LED legend dot
function Led({ tone, pulse }: { tone: 'amber' | 'green' | 'dark'; pulse?: boolean }) {
  const bg = tone === 'amber' ? 'var(--amber, #d98f2b)' : tone === 'green' ? 'var(--green, #179161)' : 'var(--ink, #17201b)';
  return (
    <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center">
      <span className="h-3 w-3 rounded-full border" style={{ background: tone === 'dark' ? 'transparent' : bg, borderColor: tone === 'dark' ? 'var(--ink-3, #7c877f)' : bg, animation: pulse ? 'ledpulse 2.2s ease-in-out infinite' : undefined }} />
      <style>{`@keyframes ledpulse { 0%,100% { opacity: 1 } 50% { opacity: 0.25 } }`}</style>
    </span>
  );
}

const MODES = [
  {
    name: 'Longevity',
    band: '10-90%',
    tag: 'default',
    body: 'Software-cuts wall power so the Mac runs on battery down to 10%, restores power to charge to 90%, turns around and repeats. Never reaches 100%, never sits at full. The charger stays plugged in the whole time.',
  },
  {
    name: 'Calibration',
    band: '5-100% + 1h hold',
    tag: 'on demand',
    body: 'Full-range passes that feed the gas gauge and macOS the data their health estimates re-learn from. Run it for a few days when the health numbers look stale, then switch back to Longevity.',
  },
  {
    name: 'Paused / Off',
    band: 'stock Mac',
    tag: 'one click',
    body: 'The software cut lifts instantly and the Mac charges to 100% like a normal Mac. Unplugging the charger also auto-suspends cycling until AC returns. Nothing persists except the logs.',
  },
];

const LEDS: Array<{ led: React.ReactNode; label: string; means: string }> = [
  { led: <Led tone="dark" />, label: 'Dark while plugged in', means: 'draining in Longevity - a normal Mac never shows a dark connector, so dark = BattCal is working' },
  { led: <Led tone="green" pulse />, label: 'Slow green pulse', means: 'calibration drain in progress' },
  { led: <Led tone="amber" />, label: 'Amber', means: 'actually charging toward the band top' },
  { led: <Led tone="green" />, label: 'Green', means: 'at target, not charging' },
];

export default function App() {
  return (
    <main>
      {/* Hero */}
      <header className="mx-auto w-full max-w-5xl px-5 pt-14 sm:pt-24">
        <div className="flex items-center gap-3">
          <img src={`${BASE}icon-192.png`} alt="" width={44} height={44} className="rounded-[10px]" />
          <span className="font-mono text-sm font-semibold tracking-wide">BattCalBar</span>
          <span className="font-mono text-xs" style={{ color: 'var(--ink-3, #7c877f)' }}>for Apple Silicon Macs</span>
        </div>
        <h1 className="display mt-8 max-w-3xl text-4xl sm:text-6xl">
          Stop parking your battery at 100%.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed" style={{ color: 'var(--ink-2, #48544d)' }}>
          Lithium cells age fastest sitting at full charge - exactly where a docked MacBook lives.
          BattCalBar cycles your battery inside a healthy 10-90% band while the charger stays plugged in,
          and re-calibrates the health numbers on demand.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a className="btn-primary" href={RELEASES}>
            <Download size={16} /> Download for Apple Silicon
          </a>
          <a className="btn-secondary" href={GITHUB}>
            <GithubMark size={16} /> View on GitHub
          </a>
          <span className="font-mono text-xs" style={{ color: 'var(--ink-3, #7c877f)' }}>free · open source · macOS 14+</span>
        </div>

        <div className="card mt-14 p-6 sm:p-8">
          <BandGauge />
        </div>
      </header>

      {/* Why */}
      <Section eyebrow="why bands" title="Full is the worst parking spot">
        <div className="grid gap-6 text-[15px] leading-relaxed sm:grid-cols-2" style={{ color: 'var(--ink-2, #48544d)' }}>
          <p>
            A MacBook that lives on the charger holds its cells at 100% for months. High state of charge
            is the single biggest aging factor for lithium batteries - bigger than cycling them. macOS
            mitigates with an 80% limit; BattCalBar goes further and keeps the battery moving through
            the healthy middle instead of sitting anywhere at all.
          </p>
          <p>
            The second problem: shallow, plugged-in charging starves the battery gauge and macOS of the
            full-range data their health estimates calibrate against, so "Maximum Capacity" drifts from
            reality - sometimes by 10+ points. BattCalBar's calibration mode runs complete, controlled
            full-range passes so both estimators re-learn the truth.
          </p>
        </div>
      </Section>

      {/* Menu bar */}
      <Section eyebrow="in your menu bar" title="Glanceable, one click to control">
        <div className="grid items-start gap-8 lg:grid-cols-2">
          <div>
            <p className="text-[15px] leading-relaxed" style={{ color: 'var(--ink-2, #48544d)' }}>
              A native SwiftUI menu bar app. Icon-only by default (macOS already shows the charge percent);
              right-click cycles the readout through watts, time to target, and true health. The popover
              switches modes, pauses everything, or opens the full dashboard.
            </p>
            <div className="card mt-6 inline-flex items-center gap-3 p-4">
              <img src={`${BASE}menubar-strip.png`} alt="BattCalBar readout in the macOS menu bar: -22.8W, 2:18 to target" width={85} height={26} className="rounded" />
              <span className="font-mono text-xs" style={{ color: 'var(--ink-3, #7c877f)' }}>watts + time readout, live in the bar</span>
            </div>
            <ul className="mt-6 space-y-3">
              {LEDS.map((l) => (
                <li key={l.label} className="flex items-baseline gap-3 text-sm">
                  {l.led}
                  <span>
                    <span className="font-semibold">{l.label}</span>
                    <span style={{ color: 'var(--ink-2, #48544d)' }}> - {l.means}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 font-mono text-xs" style={{ color: 'var(--ink-3, #7c877f)' }}>
              Yes - even your MagSafe LED becomes a status light.
            </p>
          </div>
          <img
            src={`${BASE}menubar-popover.png`}
            alt="BattCalBar popover: battery percent, charge chart, Longevity / Calibration / Normal charging modes, power and health stats"
            width={366} height={483}
            className="w-full max-w-sm justify-self-center rounded-2xl border shadow-xl lg:justify-self-end"
            style={{ borderColor: 'var(--line, #e2e6df)' }}
            loading="lazy"
          />
        </div>
      </Section>

      {/* Modes */}
      <Section eyebrow="modes" title="Two jobs, one switch">
        <div className="grid gap-4 md:grid-cols-3">
          {MODES.map((m) => (
            <article key={m.name} className="card flex flex-col p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold">{m.name}</h3>
                <span className="rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider" style={{ background: 'var(--green-tint, #e5f3ec)', color: 'var(--green-deep, #0d6b46)' }}>{m.tag}</span>
              </div>
              <p className="mt-1 font-mono text-sm" style={{ color: 'var(--green, #179161)' }}>{m.band}</p>
              <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--ink-2, #48544d)' }}>{m.body}</p>
            </article>
          ))}
        </div>
      </Section>

      {/* Dashboard */}
      <Section eyebrow="the dashboard" title="Every watt, logged and charted">
        <p className="max-w-2xl text-[15px] leading-relaxed" style={{ color: 'var(--ink-2, #48544d)' }}>
          A local web dashboard rides along: live charge and power-flow charts, per-cycle health history,
          an AppleCare-ready evidence report, and the engine's full activity log. It runs on your Mac,
          for your eyes - nothing leaves the machine.
        </p>
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <img src={`${BASE}dashboard-overview.png`} alt="BattCal dashboard overview: battery, power flow, temperature and health tiles with live charts" width={1440} height={900} className="card h-auto w-full" loading="lazy" />
          <img src={`${BASE}dashboard-health.png`} alt="BattCal dashboard health view: capacity per cycle, cycle count and cycle history table" width={1440} height={900} className="card h-auto w-full" loading="lazy" />
        </div>
      </Section>

      {/* Install */}
      <Section id="install" eyebrow="install" title="Two ways in">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card min-w-0 p-6">
            <h3 className="font-bold">Just the menu bar app</h3>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--ink-2, #48544d)' }}>
              Download the zip from the <a className="underline" style={{ color: 'var(--green-deep, #0d6b46)' }} href={RELEASES}>latest release</a>, move
              <span className="font-mono text-[13px]"> BattCalBar.app</span> to Applications, then clear the download
              quarantine once (the build is ad-hoc signed, not notarized):
            </p>
            <pre className="terminal mt-4 p-4"><code>xattr -dr com.apple.quarantine /Applications/BattCalBar.app</code></pre>
          </div>
          <div className="card min-w-0 p-6">
            <h3 className="font-bold">The full engine + dashboard</h3>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--ink-2, #48544d)' }}>
              Clone the repo and run the installer. It sets up the cycling engine and dashboard,
              and starts <span className="font-semibold">paused</span> - it never changes how your Mac charges until you turn it on.
            </p>
            <pre className="terminal mt-4 p-4"><code>{`git clone ${GITHUB}.git
cd battcal && ./install.sh`}</code></pre>
          </div>
        </div>
        <p className="mt-5 flex items-center gap-2 font-mono text-xs" style={{ color: 'var(--ink-3, #7c877f)' }}>
          <ArrowDown size={13} /> Requires an Apple Silicon MacBook. Everything runs locally; the app phones no one.
        </p>
      </Section>

      {/* License + contact */}
      <Section id="contact" eyebrow="license" title="Free for you. Commercial? Talk to me.">
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="text-[15px] leading-relaxed" style={{ color: 'var(--ink-2, #48544d)' }}>
            <p>
              BattCal is source-available under the <span className="font-semibold">PolyForm Noncommercial</span> license:
              use it, read it, modify it, and share it freely for personal and other noncommercial purposes.
            </p>
            <p className="mt-4">
              Want to use it in a commercial product or workplace deployment? Send a note through the form -
              it goes straight to the developer.
            </p>
          </div>
          <ContactForm />
        </div>
      </Section>

      <footer className="mx-auto w-full max-w-5xl px-5 pb-14">
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-6 font-mono text-xs" style={{ borderColor: 'var(--line, #e2e6df)', color: 'var(--ink-3, #7c877f)' }}>
          <span>BattCalBar · built by Parsa Mivehchi</span>
          <span className="flex items-center gap-4">
            <a className="underline" href={GITHUB}>GitHub</a>
            <a className="underline" href={RELEASES}>Latest release</a>
          </span>
        </div>
      </footer>
    </main>
  );
}
