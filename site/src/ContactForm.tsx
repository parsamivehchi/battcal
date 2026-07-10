import { useRef, useState, type FormEvent } from 'react';

type SendState = 'idle' | 'sending' | 'sent' | 'error';

// Commercial-licensing / question form. The owner's address never appears in the page
// or the DOM: the serverless function holds it. Bot layers: Vercel BotID classification
// server-side, a honeypot field, and a minimum-fill-time check seeded at mount.
export function ContactForm() {
  const [state, setState] = useState<SendState>('idle');
  const [error, setError] = useState('');
  const mountedAt = useRef(Date.now());

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    setState('sending');
    setError('');
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/contact`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...data, t: mountedAt.current }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setState('sent');
      form.reset();
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  if (state === 'sent') {
    return (
      <div className="card p-6 text-sm" role="status" style={{ color: 'var(--ink-2, #48544d)' }}>
        <p className="font-semibold" style={{ color: 'var(--green-deep, #0d6b46)' }}>Message sent.</p>
        <p className="mt-1">Thanks - expect a reply within a couple of days.</p>
      </div>
    );
  }

  const field = 'w-full rounded-lg border px-3 py-2.5 text-sm';
  const fieldStyle = { borderColor: 'var(--line, #e2e6df)', background: 'var(--card, #fff)', color: 'var(--ink, #17201b)' };

  return (
    <form onSubmit={submit} className="card grid gap-3 p-6 sm:grid-cols-2">
      <label className="grid gap-1.5 text-xs font-semibold" style={{ color: 'var(--ink-2, #48544d)' }}>
        Name
        <input name="name" required maxLength={120} autoComplete="name" className={field} style={fieldStyle} />
      </label>
      <label className="grid gap-1.5 text-xs font-semibold" style={{ color: 'var(--ink-2, #48544d)' }}>
        Email
        <input name="email" type="email" required maxLength={200} autoComplete="email" className={field} style={fieldStyle} />
      </label>
      <label className="grid gap-1.5 text-xs font-semibold sm:col-span-2" style={{ color: 'var(--ink-2, #48544d)' }}>
        Reason
        <select name="intent" className={field} style={fieldStyle} defaultValue="commercial">
          <option value="commercial">Commercial licensing</option>
          <option value="question">Question or feedback</option>
        </select>
      </label>
      <label className="grid gap-1.5 text-xs font-semibold sm:col-span-2" style={{ color: 'var(--ink-2, #48544d)' }}>
        Message
        <textarea name="message" required minLength={20} maxLength={4000} rows={5} className={field} style={fieldStyle} />
      </label>
      {/* honeypot: humans never see or fill this */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Company website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {state === 'error' && (
        <p className="text-xs sm:col-span-2" role="alert" style={{ color: 'var(--red, #c4463d)' }}>
          Could not send: {error}. Try again in a minute.
        </p>
      )}
      <div className="sm:col-span-2">
        <button type="submit" disabled={state === 'sending'} className="btn-primary" style={{ opacity: state === 'sending' ? 0.6 : 1 }}>
          {state === 'sending' ? 'Sending...' : 'Send message'}
        </button>
      </div>
    </form>
  );
}
