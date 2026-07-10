// The one server surface on the public site: the commercial-licensing / question form.
// The destination address lives only here (env), never in the page. Bot layers, in order:
// honeypot field, minimum-fill-time, per-IP rate limit, Vercel BotID classification.
// BotID being unavailable degrades to the other layers instead of blocking humans.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';

const TO = process.env.CONTACT_TO || 'dev@mivehchi.net';
const FROM = process.env.RESEND_FROM || 'BattCalBar <onboarding@resend.dev>';
const MIN_FILL_MS = 3000;

// Best-effort per-instance rate limit (serverless instances are short-lived; this is a
// speed bump for bursts, not the primary defense).
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const windowHits = (hits.get(ip) || []).filter((t) => now - t < 600e3);
  windowHits.push(now);
  hits.set(ip, windowHits);
  return windowHits.length > 3;
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = str(body.name, 120);
  const email = str(body.email, 200);
  const message = str(body.message, 4000);
  const intent = str(body.intent, 40) === 'question' ? 'question' : 'commercial';
  const honeypot = str(body.website, 200);
  const mountedAt = Number(body.t);

  // Bot layers. Honeypot and a sub-3s fill are near-certain automation; answer 200 so
  // the bot believes it succeeded and moves on, but send nothing.
  if (honeypot) return res.status(200).json({ ok: true });
  if (!Number.isFinite(mountedAt) || Date.now() - mountedAt < MIN_FILL_MS) {
    return res.status(200).json({ ok: true });
  }

  const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  if (rateLimited(ip)) return res.status(429).json({ error: 'too many messages, try later' });

  try {
    const { checkBotId } = await import('botid/server');
    const verdict = await checkBotId();
    if (verdict.isBot) return res.status(200).json({ ok: true });
  } catch {
    // BotID unavailable (local dev, proxy edge cases): the layers above still apply.
  }

  if (!name || !email || message.length < 20) {
    return res.status(400).json({ error: 'name, email, and a message of at least 20 characters are required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'that email does not look valid' });
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) return res.status(503).json({ error: 'contact is not configured yet' });

  try {
    const resend = new Resend(key);
    const { error } = await resend.emails.send({
      from: FROM,
      to: TO,
      replyTo: email,
      subject: `[battcal] ${intent === 'commercial' ? 'Commercial licensing' : 'Question'} - ${name}`,
      text: `From: ${name} <${email}>\nIntent: ${intent}\nIP: ${ip}\n\n${message}`,
    });
    if (error) throw new Error(error.message);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ error: `send failed: ${e instanceof Error ? e.message : 'unknown'}` });
  }
}
