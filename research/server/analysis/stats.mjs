// Estadística honesta para muestras pequeñas: intervalos Beta (Jeffreys), muestreo Beta para Thompson.
// Regla de producto: con pocos datos se muestra "k de n · rango a–b %", nunca un porcentaje suelto.

function logGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5, ser = 1.000000000190015;
  tmp -= (x + 0.5) * Math.log(tmp);
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function betacf(a, b, x) {
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d; let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}
/** Beta regularizada incompleta I_x(a, b). */
export function betaCdf(x, a, b) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
export function betaQuantile(p, a, b) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (betaCdf(mid, a, b) < p) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
/** Intervalo creíble de una proporción k/n con prior Beta(α, β) (Jeffreys por defecto) al nivel dado. */
export function rateInterval(k, n, { alpha = 0.5, beta = 0.5, level = 0.9 } = {}) {
  if (!n) return { k: 0, n: 0, mean: null, lo: null, hi: null, label: 'no data' };
  const a = k + alpha, b = n - k + beta, t = (1 - level) / 2;
  const lo = k === 0 ? 0 : betaQuantile(t, a, b), hi = k === n ? 1 : betaQuantile(1 - t, a, b);
  const pct = (x) => `${Math.round(100 * x)}`;
  return { k, n, mean: a / (a + b), lo, hi, label: `${k} of ${n} · range ${pct(lo)}–${pct(hi)}%` };
}

/** Generador reproducible (mulberry32). */
export const seeded = (seed = 1) => () => { let t = (seed += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function gammaSample(k, rng) {
  if (k < 1) return gammaSample(k + 1, rng) * Math.pow(rng(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { const u1 = rng(), u2 = rng(); x = Math.sqrt(-2 * Math.log(u1 || 1e-12)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0);
    v = v * v * v; const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
export const betaSample = (a, b, rng = Math.random) => { const x = gammaSample(a, rng), y = gammaSample(b, rng); return x / (x + y); };
