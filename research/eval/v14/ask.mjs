// Responde las 12 preguntas de auditoría V14 a partir de una carpeta de corrida.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const dir = resolve(process.argv[2] || '');
const number = Number(process.argv[3]);
if (!process.argv[2] || !Number.isInteger(number) || number < 1 || number > 12) {
  console.error('Uso: node eval/v14/ask.mjs <dir> <1..12>'); process.exit(2);
}
const readJson = (name, fallback) => existsSync(join(dir, name)) ? JSON.parse(readFileSync(join(dir, name), 'utf8')) : fallback;
const lines = existsSync(join(dir, 'events.jsonl')) ? readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const summary = readJson('summary.json', {});
const events = (type) => lines.filter((e) => e.type === type);
const fmt = (value) => JSON.stringify(value, null, 2);

function coverage() {
  const root = join(dir, 'coverage'); const files = new Set(); let functions = 0;
  if (existsSync(root)) for (const name of readdirSync(root).filter((x) => x.endsWith('.json'))) try {
    const data = JSON.parse(readFileSync(join(root, name), 'utf8'));
    for (const script of data.result || []) {
      const hit = (script.functions || []).filter((fn) => (fn.ranges || []).some((r) => r.count > 0));
      if (hit.length) { files.add(script.url); functions += hit.length; }
    }
  } catch { /* cobertura parcial */ }
  return { files_executed: files.size, functions_executed: functions, path: 'coverage/' };
}

const answers = {
  1: () => events('page').map(({ ref, url, found_by }) => ({ ref, url, found_by })),
  2: () => ({ pages: events('page').map(({ ref, url, read }) => ({ ref, url, read })), unread: events('drop').filter((e) => !e.read).map(({ url, reason }) => ({ url, reason })) }),
  3: () => events('drop').map(({ url, reason, decided_by }) => ({ url, reason, decided_by })),
  4: () => events('decision').flatMap((e) => (e.dates || []).map((date) => ({ page_ref: e.page_ref, by: e.by, date, days_left: e.days_left }))),
  5: () => events('decision').map(({ page_ref, by, criteria, verdict }) => ({ page_ref, by, verdict, criteria: criteria || {} })),
  6: () => ({ model_calls: summary.model_calls || {}, tools: summary.tools || {} }),
  7: () => ({ leads: events('lead'), followups: events('lead_followup'), produced: events('tool_call').filter((e) => e.from_lead) }),
  8: () => ({ understood: events('understand'), assumptions: events('brief_patch').filter((e) => e.source === 'assumption'), questions: events('ask_user'), patches: events('brief_patch') }),
  9: () => {
    const finish = events('finish').map((e) => e.reason); const ended = events('run_end');
    return { reason: finish.length ? finish : ended.length ? ['run_end:natural_completion'] : ['unknown'], budget: events('budget'), run_end: ended.map(({ seconds, totals }) => ({ seconds, totals })) };
  },
  10: () => events('page').map(({ ref, sha256, path, chars }) => ({ ref, sha256, path, chars, exists: existsSync(join(dir, path)) })),
  11: () => events('model_call').map(({ page_ref, role, model, prompt_version }) => ({ page_ref: page_ref ?? null, role, model, prompt_version })),
  12: () => coverage(),
};

console.log(fmt(answers[number]()));
