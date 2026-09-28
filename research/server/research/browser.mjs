/* ─────────────────────────────────────────────────────────────────────────────
   Navegador real para el Live Agent Run.
   · Una sola instancia de Chromium headless compartida por todo el servidor.
   · Cola: como máximo una página abierta a la vez; cada visita usa un contexto
     nuevo (sin cookies ni almacenamiento previo) que se cierra al terminar.
   · Se bloquean vídeo, audio, sockets y trackers; se conservan documento, CSS,
     imágenes, fuentes y scripts propios para que la captura sea reconocible.
   · Si Playwright o Chromium no están disponibles, `visit` lanza un error con
     code BROWSER_UNAVAILABLE y el pipeline continúa por HTTP.
   ───────────────────────────────────────────────────────────────────────────── */
const BLOCKED_TYPES = new Set(['media', 'websocket', 'eventsource', 'manifest', 'texttrack', 'other']);
const TRACKERS = /(^|\.)(google-analytics\.com|googletagmanager\.com|googleadservices\.com|googlesyndication\.com|doubleclick\.net|facebook\.net|facebook\.com|hotjar\.com|hotjar\.io|segment\.io|segment\.com|mixpanel\.com|clarity\.ms|hs-analytics\.net|hs-scripts\.com|hs-banner\.com|hsforms\.net|hubspot\.com|ads\.linkedin\.com|snap\.licdn\.com|px\.ads\.linkedin\.com|bat\.bing\.com|quantserve\.com|scorecardresearch\.com|nr-data\.net|newrelic\.com|fullstory\.com|intercom\.io|intercomcdn\.com|youtube\.com|youtube-nocookie\.com|ytimg\.com|vimeo\.com|vimeocdn\.com|tiktok\.com|pinterest\.com|twitter\.com|ads-twitter\.com|t\.co|criteo\.com|taboola\.com|outbrain\.com|adnxs\.com|cookielaw\.org|onetrust\.com|cookiebot\.com)$/i;

export const VIEWPORT = { width: 1280, height: 720 };

export function blockedRequest(url, resourceType) {
  let host;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return parsed.protocol !== 'data:' && parsed.protocol !== 'blob:';
    host = parsed.hostname;
  } catch {
    return true;
  }
  return BLOCKED_TYPES.has(resourceType) || TRACKERS.test(host);
}

class BrowserUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.code = 'BROWSER_UNAVAILABLE';
  }
}

export function createBrowserService({
  env = process.env,
  importPlaywright = () => import('playwright'),
  navigationTimeoutMs = Math.min(30000, Math.max(3000, Number(env.RESEARCH_BROWSER_TIMEOUT_MS) || 15000)),
  jpegQuality = Math.min(85, Math.max(30, Number(env.RESEARCH_BROWSER_JPEG_QUALITY) || 60)),
} = {}) {
  let browserPromise = null;
  let unavailable = env.RESEARCH_BROWSER === 'off' ? 'Browser disabled with RESEARCH_BROWSER=off.' : null;
  let queue = Promise.resolve();
  let closed = false;
  let openPages = 0;
  let maxOpenPages = 0;

  async function ensure() {
    if (closed) throw new BrowserUnavailableError('The server is shutting down.');
    if (unavailable) throw new BrowserUnavailableError(unavailable);
    browserPromise ||= (async () => {
      let playwright;
      try {
        playwright = await importPlaywright();
      } catch {
        throw new BrowserUnavailableError('Playwright isn\'t installed (npm --prefix research install).');
      }
      const chromium = playwright.chromium || playwright.default?.chromium;
      if (!chromium) throw new BrowserUnavailableError('Playwright doesn\'t expose Chromium.');
      try {
        const browser = await chromium.launch({
          headless: true,
          executablePath: env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
          args: ['--disable-dev-shm-usage', '--disable-gpu', '--mute-audio', '--disable-extensions', '--no-first-run', '--disable-background-networking'],
        });
        browser.on?.('disconnected', () => {
          browserPromise = null;
        });
        return browser;
      } catch (error) {
        throw new BrowserUnavailableError(`Chromium couldn't start (${String(error?.message || error).split('\n')[0].slice(0, 160)}). Run: npm --prefix research run browser:install`);
      }
    })().catch((error) => {
      browserPromise = null;
      // Una instalación incompleta no se reintenta en cada fuente.
      if (error.code === 'BROWSER_UNAVAILABLE') unavailable = error.message;
      throw error;
    });
    return browserPromise;
  }

  async function run(url, { screenshot = true, onOpened, onLoaded, userAgent } = {}) {
    const browser = await ensure();
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      userAgent: userAgent || env.RESEARCH_USER_AGENT || undefined,
      javaScriptEnabled: true,
      serviceWorkers: 'block',
      acceptDownloads: false,
      locale: 'en-US',
    });
    openPages += 1;
    maxOpenPages = Math.max(maxOpenPages, openPages);
    try {
      await context.route('**/*', (route) => (blockedRequest(route.request().url(), route.request().resourceType()) ? route.abort() : route.continue()));
      const page = await context.newPage();
      page.setDefaultTimeout(navigationTimeoutMs);
      const started = Date.now();
      onOpened?.();
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });
      if (!response) throw new Error('The browser got no response for the document.');
      const status = response.status();
      const finalUrl = page.url();
      const loadedMs = Date.now() - started;
      onLoaded?.({ status, finalUrl, durationMs: loadedMs });
      // HTML tal como lo sirvió el sitio: la extracción es la misma que por HTTP.
      const html = status >= 200 && status < 300 ? await response.text() : '';
      if (Buffer.byteLength(html) > 5_000_000) throw new Error('Response exceeds 5 MB.');
      let image = null;
      if (screenshot) {
        // Breve espera para CSS/imágenes; no se espera a la red completa.
        await page.waitForLoadState('load', { timeout: 2500 }).catch(() => {});
        image = await page.screenshot({ type: 'jpeg', quality: jpegQuality, fullPage: false, timeout: 8000 });
      }
      await page.close().catch(() => {});
      return { status, finalUrl, html, screenshot: image, durationMs: Date.now() - started };
    } finally {
      openPages -= 1;
      await context.close().catch(() => {});
    }
  }

  return {
    /** Visita una URL pública. Las visitas se encolan: nunca hay dos páginas abiertas a la vez. */
    visit(url, options) {
      const task = queue.then(() => run(url, options));
      queue = task.catch(() => {});
      return task;
    },
    status() {
      return { available: !unavailable, reason: unavailable, launched: Boolean(browserPromise), maxOpenPages };
    },
    async close() {
      closed = true;
      const pending = browserPromise;
      browserPromise = null;
      const browser = await pending?.catch(() => null);
      await browser?.close().catch(() => {});
    },
  };
}
