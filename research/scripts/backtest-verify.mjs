// Verifica literal cada cita del conjunto del backtest contra la página (desde tu Mac, con red).
//   node scripts/backtest-verify.mjs  → actualiza quote_verified en ../backend/eval/backtest_rounds.json
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { plainText, quoteInPage } from '../server/analysis/deals.mjs';
const path = resolve('../backend/eval/backtest_rounds.json');
const data = JSON.parse(readFileSync(path, 'utf8'));
const htmlText = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"').replace(/&#8211;|&#8212;/g, '-').replace(/&#?\w+;/g, ' ');
let ok = 0;
for (const r of data.rounds) {
  try {
    const res = await fetch(r.url, { headers: { 'User-Agent': 'Mozilla/5.0 (IGC Outreach research; verificación de citas)' }, signal: AbortSignal.timeout(20000) });
    const text = plainText(htmlText(await res.text()));
    r.quote_verified = quoteInPage(r.quote, text);
    r.quote_checked_at = new Date().toISOString();
    if (r.quote_verified) ok++;
    console.log(r.quote_verified ? '✔' : '✖', r.id, r.company, res.status);
  } catch (e) { console.log('?', r.id, e.message); }
}
writeFileSync(path, JSON.stringify(data, null, 2));
console.log(`${ok}/${data.rounds.length} citas verificadas literal.`);
