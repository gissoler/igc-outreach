/* ─────────────────────────────────────────────────────────────────────────────
   Navegador remoto para la pestaña "Official page".
   Muchos sitios (.gov, fundaciones) prohíben que otra app los muestre en un
   iframe. Aquí la página corre en un Chromium headless del servidor y la app
   muestra cada fotograma; los clics, el scroll y el teclado del usuario se
   traducen a acciones del navegador. Así se navega dentro de la app en cualquier
   sitio, sin abrir otra pestaña.

   Seguridad:
   · La URL inicial la decide el servidor (officialUrlOf), nunca el cliente.
   · Cada petición del navegador, incluidas redirecciones y enlaces que el
     usuario abra, se bloquea si el host resuelve a una red privada, loopback o
     link-local (protección SSRF).
   · Contexto nuevo por sesión (sin cookies), descargas y service workers
     bloqueados, diálogos descartados, vídeo/audio/trackers bloqueados.
   · Máximo de sesiones, una por usuario, cierre por inactividad y por vida máxima.
   ───────────────────────────────────────────────────────────────────────────── */
import dns from 'node:dns/promises';
import net from 'node:net';
import { blockedRequest } from './browser.mjs';
import { safeUrl } from './core.mjs';

export const REMOTE_VIEWPORT = { width: 1100, height: 760 };
const KEYS = new Set(['Enter', 'Backspace', 'Delete', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);

class RemoteError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function isPrivateAddress(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPrivateAddress(mapped[1]);
    return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb');
  }
  return true;
}

export async function hostIsPublic(hostname, lookup = dns.lookup) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (net.isIP(host)) return !isPrivateAddress(host);
  if (/^localhost$|\.localhost$|\.local$|\.internal$|\.lan$/i.test(host)) return false;
  try {
    const found = await lookup(host, { all: true });
    return found.length > 0 && found.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

export function createRemoteBrowser({
  env = process.env,
  importPlaywright = () => import('playwright'),
  lookup = dns.lookup,
  now = () => Date.now(),
  maxSessions = 3,
  idleMs = 150_000,
  lifeMs = 15 * 60_000,
  sweepMs = 30_000,
  viewport = REMOTE_VIEWPORT,
  jpegQuality = Math.min(85, Math.max(35, Number(env.RESEARCH_BROWSER_JPEG_QUALITY) || 68)),
} = {}) {
  const sessions = new Map(); // key → session
  let browserPromise = null;
  let unavailable = env.RESEARCH_BROWSER === 'off' ? 'The browser is disabled with RESEARCH_BROWSER=off.' : null;
  let closed = false;

  async function ensure() {
    if (closed) throw new RemoteError('BROWSER_UNAVAILABLE', 'The server is shutting down.');
    if (unavailable) throw new RemoteError('BROWSER_UNAVAILABLE', unavailable);
    browserPromise ||= (async () => {
      let playwright;
      try { playwright = await importPlaywright(); } catch { throw new RemoteError('BROWSER_UNAVAILABLE', "Playwright isn't installed (npm --prefix research install)."); }
      const chromium = playwright.chromium || playwright.default?.chromium;
      if (!chromium) throw new RemoteError('BROWSER_UNAVAILABLE', "Playwright doesn't expose Chromium.");
      try {
        const browser = await chromium.launch({
          headless: true,
          executablePath: env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
          args: ['--disable-dev-shm-usage', '--disable-gpu', '--mute-audio', '--disable-extensions', '--no-first-run', '--disable-background-networking'],
        });
        browser.on?.('disconnected', () => { browserPromise = null; sessions.clear(); });
        return browser;
      } catch (e) {
        throw new RemoteError('BROWSER_UNAVAILABLE', `Chromium couldn't start (${String(e?.message || e).split('\n')[0].slice(0, 140)}). Run: npm run browser:install (inside research/).`);
      }
    })().catch((e) => {
      browserPromise = null;
      if (e.code === 'BROWSER_UNAVAILABLE') unavailable = e.message;
      throw e;
    });
    return browserPromise;
  }

  const enqueue = (s, fn) => { const p = s.chain.then(fn); s.chain = p.catch(() => {}); return p; };

  async function dispose(key) {
    const s = sessions.get(key);
    if (!s) return;
    sessions.delete(key);
    await s.context.close().catch(() => {});
  }

  async function frame(s) {
    const page = s.page;
    await page.waitForLoadState('load', { timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(120).catch(() => {});
    const buf = await page.screenshot({ type: 'jpeg', quality: jpegQuality, fullPage: false, timeout: 8000 });
    return { url: page.url(), title: await page.title().catch(() => ''), image: buf.toString('base64'), width: viewport.width, height: viewport.height };
  }

  const sweeper = setInterval(() => {
    const t = now();
    for (const [key, s] of sessions) if (t - s.lastUsed > idleMs || t - s.startedAt > lifeMs) void dispose(key);
  }, sweepMs);
  sweeper.unref?.();

  return {
    /** Abre (o reutiliza) la sesión de `key` en `url`. `owner` limita a una sesión por usuario. */
    async open(key, url, { owner = key, refresh = false } = {}) {
      const start = safeUrl(url);
      if (!start) throw new RemoteError('BAD_ACTION', 'Only https pages can be opened.');
      const existing = sessions.get(key);
      if (existing && !refresh) {
        existing.lastUsed = now();
        return enqueue(existing, () => frame(existing));
      }
      if (existing) await dispose(key);
      if (!(await hostIsPublic(new URL(start).hostname, lookup))) throw new RemoteError('BLOCKED_HOST', 'That address is not a public website.');
      for (const [k, s] of sessions) if (s.owner === owner) await dispose(k);
      while (sessions.size >= maxSessions) {
        const oldest = [...sessions.entries()].sort((a, z) => a[1].lastUsed - z[1].lastUsed)[0];
        await dispose(oldest[0]);
      }
      const browser = await ensure();
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, javaScriptEnabled: true, serviceWorkers: 'block', acceptDownloads: false, locale: 'en-US', userAgent: env.RESEARCH_USER_AGENT || undefined });
      const verdicts = new Map();
      const hostOk = async (host) => { if (!verdicts.has(host)) verdicts.set(host, hostIsPublic(host, lookup)); return verdicts.get(host); };
      await context.route('**/*', async (route) => {
        const req = route.request();
        const target = req.url();
        if (blockedRequest(target, req.resourceType())) return route.abort();
        try {
          const u = new URL(target);
          if (/^https?:$/.test(u.protocol) && !(await hostOk(u.hostname))) return route.abort();
        } catch { return route.abort(); }
        return route.continue();
      });
      const s = { key, owner, context, page: null, chain: Promise.resolve(), lastUsed: now(), startedAt: now() };
      const adopt = (p) => {
        s.page = p;
        p.setDefaultTimeout?.(15000);
        p.on?.('dialog', (d) => { d.dismiss().catch(() => {}); });
        p.on?.('download', (d) => { d.cancel?.().catch(() => {}); });
      };
      context.on?.('page', adopt);
      adopt(await context.newPage());
      sessions.set(key, s);
      try {
        return await enqueue(s, async () => {
          await s.page.goto(start, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch((e) => { if (!s.page.url() || s.page.url() === 'about:blank') throw e; });
          return frame(s);
        });
      } catch (e) {
        await dispose(key);
        throw new RemoteError('LOAD_FAILED', `The page didn't load (${String(e?.message || e).split('\n')[0].slice(0, 120)}).`);
      }
    },

    /** Una acción del usuario sobre la sesión abierta; devuelve el fotograma nuevo. */
    async act(key, a) {
      const s = sessions.get(key);
      if (!s) throw new RemoteError('NO_SESSION', 'The browser session expired. Reload the page.');
      s.lastUsed = now();
      const num = (v, lo, hi) => { const n = Number(v); if (!Number.isFinite(n)) throw new RemoteError('BAD_ACTION', 'Invalid action.'); return Math.max(lo, Math.min(hi, n)); };
      return enqueue(s, async () => {
        const page = s.page;
        switch (a?.action) {
          case 'click': await page.mouse.click(num(a.x, 0, viewport.width), num(a.y, 0, viewport.height)); break;
          case 'scroll': await page.mouse.wheel(0, num(a.dy, -3000, 3000)); break;
          case 'type': { const text = String(a.text ?? '').slice(0, 200); if (text) await page.keyboard.type(text, { delay: 8 }); break; }
          case 'key': if (!KEYS.has(a.key)) throw new RemoteError('BAD_ACTION', 'Key not allowed.'); await page.keyboard.press(a.key); break;
          case 'back': await page.goBack({ timeout: 8000, waitUntil: 'domcontentloaded' }).catch(() => {}); break;
          case 'reload': await page.reload({ timeout: 15000, waitUntil: 'domcontentloaded' }).catch(() => {}); break;
          default: throw new RemoteError('BAD_ACTION', 'Unknown action.');
        }
        s.lastUsed = now();
        return frame(s);
      });
    },

    close: (key) => dispose(key),
    status: () => ({ available: !unavailable, reason: unavailable, sessions: sessions.size }),
    async closeAll() {
      closed = true;
      clearInterval(sweeper);
      for (const key of [...sessions.keys()]) await dispose(key);
      const b = await browserPromise?.catch(() => null);
      browserPromise = null;
      await b?.close().catch(() => {});
    },
  };
}
