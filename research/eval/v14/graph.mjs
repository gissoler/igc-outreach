// Gráfica de importaciones y alcanzabilidad de funciones (acorn). Uso: node graph.mjs <raíz research> <salida.json> <entrada...>
import { parse } from 'acorn';
import { simple, full } from 'acorn-walk';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
const [root, out, ...entries] = process.argv.slice(2);
const dirs = ['server', 'agent', 'bench', 'scripts', 'eval', 'tests', 'capital'];
const files = [];
function walk(d) { for (const n of readdirSync(d)) { if (n === 'node_modules' || n.startsWith('.')) continue; const p = join(d, n); const s = statSync(p); if (s.isDirectory()) walk(p); else if (/\.(mjs|js)$/.test(n)) files.push(p); } }
for (const d of dirs) if (existsSync(join(root, d))) walk(join(root, d));
const rel = (p) => relative(root, p);
const info = {};
const errors = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8').replace(/^#!.*/, '');
  let ast; try { ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, allowAwaitOutsideFunction: true }); } catch (e) { errors.push([rel(f), e.message]); continue; }
  const imports = []; // {target, names:[...]|'*'}
  const resolveSpec = (s) => { if (!s.startsWith('.')) return null; let p = resolve(dirname(f), s); if (!existsSync(p) && existsSync(p + '.mjs')) p += '.mjs'; return existsSync(p) ? rel(p) : 'MISSING:' + rel(p); };
  const exports = new Map(); // exported name -> local name
  const reexports = [];
  for (const n of ast.body) {
    if (n.type === 'ImportDeclaration') { const t = resolveSpec(n.source.value); if (!t) continue; const names = []; let star = false; for (const s of n.specifiers) { if (s.type === 'ImportSpecifier') names.push(s.imported.name ?? s.imported.value); else if (s.type === 'ImportDefaultSpecifier') names.push('default'); else star = true; } imports.push({ target: t, names: star ? '*' : names, side: n.specifiers.length === 0 }); }
    if (n.type === 'ExportNamedDeclaration') {
      if (n.source) { const t = resolveSpec(n.source.value); if (t) { const names = n.specifiers.map((s) => s.local.name ?? s.local.value); imports.push({ target: t, names }); for (const s of n.specifiers) reexports.push({ name: s.exported.name ?? s.exported.value, target: t, orig: s.local.name }); } }
      else if (n.declaration) { const d = n.declaration; if (d.id) exports.set(d.id.name, d.id.name); else if (d.declarations) for (const v of d.declarations) if (v.id.name) exports.set(v.id.name, v.id.name); }
      else for (const s of n.specifiers) exports.set(s.exported.name ?? s.exported.value, s.local.name);
    }
    if (n.type === 'ExportDefaultDeclaration') exports.set('default', n.declaration.id?.name || '__default');
    if (n.type === 'ExportAllDeclaration') { const t = resolveSpec(n.source.value); if (t) imports.push({ target: t, names: '*' }); }
  }
  full(ast, (n) => { if (n.type === 'ImportExpression' && n.source.type === 'Literal') { const t = resolveSpec(n.source.value); if (t) imports.push({ target: t, names: '*', dynamic: true }); } if (n.type === 'ImportExpression' && n.source.type !== 'Literal') imports.push({ target: 'DYNAMIC_NONLITERAL', names: '*', dynamic: true }); });
  // funciones de nivel superior y sus referencias
  const decls = new Map(); const topRefs = new Set();
  const idsIn = (node) => { const s = new Set(); full(node, (x) => { if (x.type === 'Identifier') s.add(x.name); }); return s; };
  for (let n of ast.body) {
    if ((n.type === 'ExportNamedDeclaration' || n.type === 'ExportDefaultDeclaration') && n.declaration) n = n.declaration;
    if (n.type === 'FunctionDeclaration' && n.id) decls.set(n.id.name, { refs: idsIn(n.body), line: n.loc?.start?.line ?? null, start: n.start, end: n.end });
    else if (n.type === 'VariableDeclaration') { for (const v of n.declarations) { if (v.id.type === 'Identifier' && v.init && /Function|Arrow/.test(v.init.type)) decls.set(v.id.name, { refs: idsIn(v.init), start: v.start, end: v.end }); else if (v.init) for (const x of idsIn(v.init)) topRefs.add(x); } }
    else if (n.type === 'ClassDeclaration' && n.id) decls.set(n.id.name, { refs: idsIn(n.body), start: n.start, end: n.end });
    else if (n.type !== 'ImportDeclaration' && n.type !== 'ExportNamedDeclaration' && n.type !== 'ExportAllDeclaration') for (const x of idsIn(n)) topRefs.add(x);
  }
  const lineOf = (pos) => src.slice(0, pos).split('\n').length;
  const lines = src.split('\n').length;
  info[rel(f)] = { imports, exports: Object.fromEntries(exports), reexports, decls: Object.fromEntries([...decls].map(([k, v]) => [k, { refs: [...v.refs], line: lineOf(v.start), lines: lineOf(v.end) - lineOf(v.start) + 1 }])), topRefs: [...topRefs], lines };
}
// alcanzabilidad de archivos
function reach(starts) { const seen = new Set(); const q = [...starts]; while (q.length) { const x = q.shift(); if (seen.has(x) || !info[x]) continue; seen.add(x); for (const i of info[x].imports) if (info[i.target]) q.push(i.target); } return seen; }
const groups = {};
for (const e of entries) { const [name, list] = e.split('='); groups[name] = list.split(','); }
const reachBy = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, reach(v)]));
const prodish = new Set(Object.entries(reachBy).filter(([k]) => k !== 'tests').flatMap(([, s]) => [...s]));
// exportaciones usadas desde archivos alcanzables (sin tests)
const used = {}; // file -> Set(names) | '*'
const mark = (t, names) => { used[t] ??= new Set(); if (names === '*') used[t].add('*'); else for (const n of names) used[t].add(n); };
for (const f of prodish) for (const i of info[f].imports) if (info[i.target]) mark(i.target, i.names);
// propagar reexportaciones
let changed = true; while (changed) { changed = false; for (const [f, s] of Object.entries(used)) for (const r of info[f]?.reexports || []) if ((s.has(r.name) || s.has('*')) && !(used[r.target]?.has(r.orig))) { mark(r.target, [r.orig]); changed = true; } }
const fnReport = {};
for (const f of prodish) {
  const I = info[f]; const u = used[f] || new Set(); const roots = new Set(I.topRefs);
  const isEntry = Object.values(groups).some((l) => l.includes(f));
  for (const [ex, loc] of Object.entries(I.exports)) if (u.has('*') || u.has(ex)) roots.add(loc);
  const live = new Set(); const q = [...roots]; while (q.length) { const x = q.shift(); if (live.has(x) || !I.decls[x]) continue; live.add(x); for (const r of I.decls[x].refs) q.push(r); }
  const dead = Object.entries(I.decls).filter(([k]) => !live.has(k)).map(([k, v]) => ({ name: k, line: v.line, lines: v.lines, exported: Object.values(I.exports).includes(k) }));
  fnReport[f] = { lines: I.lines, decls: Object.keys(I.decls).length, live: live.size, dead };
}
const all = Object.keys(info);
const unreach = all.filter((f) => !prodish.has(f) && !f.startsWith('tests/'));
const testsOnly = unreach.filter((f) => reachBy.tests?.has(f));
writeFileSync(out, JSON.stringify({ errors, groups, reachCount: Object.fromEntries(Object.entries(reachBy).map(([k, s]) => [k, s.size])), reachBy: Object.fromEntries(Object.entries(reachBy).map(([k, s]) => [k, [...s].sort()])), unreachable: unreach.map((f) => ({ f, lines: info[f].lines, testsOnly: testsOnly.includes(f) })), fnReport, info: Object.fromEntries(Object.entries(info).map(([k, v]) => [k, { lines: v.lines, imports: v.imports }])) }, null, 1));
console.log('archivos', all.length, 'errores', errors.length, JSON.stringify(Object.fromEntries(Object.entries(reachBy).map(([k, s]) => [k, s.size]))), 'inalcanzables', unreach.length, 'solo tests', testsOnly.length);
