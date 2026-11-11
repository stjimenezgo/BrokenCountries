// Corre el modelo sin interfaz para calibrar: node tools/headless.js [baseline|mc|laffer]
import { createWorld, step } from '../src/model.js';
import { monteCarlo, lafferScan } from '../src/experiments.js';

const mode = process.argv[2] || 'baseline';
const pct = (x) => (x == null ? '  -  ' : (x * 100).toFixed(1).padStart(5));

if (mode === 'baseline') {
  const seed = Number(process.argv[3] || 1);
  const w = createWorld({ seed });
  const show = (r) => console.log(
    `t=${String(r.t).padStart(2)} PIB=${r.gdp.toFixed(0)} g=${pct(r.growth)} u=${pct(r.u)} inf=${pct(r.informality)} π=${pct(r.inflation)} ` +
    `deuda=${pct(r.debtGDP)} spr=${pct(r.spread)} ${r.rating.padEnd(4)} rev=${pct(r.revenue)} gasto=${pct(r.spending)} int=${pct(r.interest)} def=${pct(r.deficit)} ` +
    `apr=${pct(r.approval)} firmas=${r.firms} e/s/r=${r.entries}/${r.exits}/${r.relocations} | c=${pct(r.corp)} v=${pct(r.vat)} n=${pct(r.payroll)} r=${pct(r.royalty)} a=${pct(r.tariff)} o=${pct(r.other)} cmd=${r.commodity.toFixed(2)}`);
  show(w.hist[0]);
  const r0 = w.hist[0];
  console.log('recaudo inicial %PIB:', ['corp','vat','payroll','royalty','tariff','other'].map(k => `${k}=${pct(r0[k])}`).join(' '));
  console.log('lerner:', Object.entries(r0.lerner).map(([k,v]) => `${k}=${pct(v)}`).join(' '));
  console.log('import share:', Object.entries(r0.importShare).map(([k,v]) => `${k}=${pct(v)}`).join(' '));
  console.log('regiones u/inf:', w.regions.map(r => `${r.id}:${pct(r.u)}/${pct(r.informality)}`).join(' '));
  for (let i = 0; i < 40; i++) { step(w); if (w.t % 4 === 0) show(w.hist[w.hist.length - 1]); }
  console.log('lenders:', JSON.stringify(w.hist.at(-1).lenders));
  console.log('regiones u/inf:', w.regions.map(r => `${r.id}:${pct(r.u)}/${pct(r.informality)}`).join(' '));
  console.log('barreras:', Object.entries(w.hist.at(-1).barrier).map(([k,v]) => `${k}=${v.toFixed(2)}`).join(' '));
  console.log('eventos:', w.events.slice(-12).map(e => `[${e.t}] ${e.text}`).join('\n  '));
} else if (mode === 'mc') {
  const runs = Number(process.argv[3] || 20);
  const t0 = Date.now();
  const res = await monteCarlo({ runs, quarters: 32 });
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  for (const r of res) console.log(
    `${r.name.padEnd(28)} default=${pct(r.defaultRate)} pierde=${pct(r.lostElectionRate)} estallido=${pct(r.estallidoRate)} ` +
    `deuda=${pct(r.debtGDP)} g=${pct(r.growth)} u=${pct(r.u)} inf=${pct(r.informality)} pob=${pct(r.poverty)} π=${pct(r.inflation)} apr=${pct(r.approval)} reloc=${r.relocated}`);
} else if (mode === 'laffer') {
  const key = process.argv[3] || 'corpTax';
  const res = await lafferScan({ key });
  for (const p of res.pts) console.log(`${key}=${pct(p.rate)} recaudo propio=${p.own.toFixed(1)} total=${p.total.toFixed(1)} PIB=${p.gdp.toFixed(0)}`);
  console.log('ajuste:', res.fit);
}
