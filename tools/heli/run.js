// Scenario runner: node tools/heli/run.js [scenarioName ...]
// Flies every scenario in scenarios.js and writes tools/heli/report.txt (a fixed-width table:
// measured value against the target from VEHICLE_NOTES.md / the task, with a real-aircraft reference).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ALL } from './scenarios.js';
import { HELI } from '../../src/heli/flight.js';

const here = dirname(fileURLToPath(import.meta.url));
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ALL);

function fmt(v) {
  if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return '-';
  if (typeof v !== 'number') return String(v);
  const a = Math.abs(v);
  return a >= 1000 ? v.toFixed(0) : a >= 100 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toFixed(3);
}

export function runAll(list = names, log = console.log) {
  const rows = []; const timing = [];
  for (const n of list) {
    const t0 = Date.now();
    const r = ALL[n]();
    timing.push(`${n} ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    rows.push(...r);
    log(`${n}: ${r.length} rows, ${r.filter((x) => x.pass === false).length} misses (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  return { rows, timing };
}

export function formatReport(rows, timing) {
  const L = [];
  L.push('H1 utility helicopter flight model: scenario report');
  L.push(`generated ${new Date().toISOString()} by node tools/heli/run.js (Node ${process.version}); model src/heli/flight.js, ${HELI.SUBSTEP_HZ} Hz sub-steps, 60 Hz frames`);
  L.push('mass 2200 kg unless stated, ISA sea level, no wind, flat ground at y = 0. PASS/MISS against the target column; "-" = reported only.');
  L.push('');
  const w = [13, 78, 10, 7, 30, 6];
  const pad = (s, n) => (s.length > n ? s.slice(0, n - 1) + '~' : s.padEnd(n));
  L.push([pad('group', w[0]), pad('item', w[1]), pad('value', w[2]), pad('unit', w[3]), pad('target', w[4]), pad('result', w[5]), 'notes / real reference'].join(' '));
  L.push('-'.repeat(200));
  let group = null;
  for (const r of rows) {
    if (r.group !== group && group != null) L.push('');
    group = r.group;
    const res = r.pass === true ? 'PASS' : r.pass === false ? 'MISS' : '-';
    L.push([pad(r.group, w[0]), pad(r.item, w[1]), pad(fmt(r.value), w[2]), pad(r.unit || '', w[3]), pad(String(r.target || ''), w[4]), pad(res, w[5]), r.ref || ''].join(' '));
  }
  L.push('');
  const miss = rows.filter((r) => r.pass === false);
  L.push(`${rows.filter((r) => r.pass === true).length} PASS, ${miss.length} MISS, ${rows.filter((r) => r.pass == null).length} reported only.`);
  if (miss.length) { L.push('Misses:'); for (const r of miss) L.push(`  - [${r.group}] ${r.item}: ${fmt(r.value)} ${r.unit} (target ${r.target})`); }
  L.push('');
  L.push(`run time: ${timing.join(', ')}`);
  return L.join('\n') + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { rows, timing } = runAll();
  const txt = formatReport(rows, timing);
  const out = names.length === Object.keys(ALL).length ? join(here, 'report.txt') : join(here, 'report.partial.txt');
  writeFileSync(out, txt);
  console.log(txt);
  console.log('wrote', out);
}
