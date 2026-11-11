// Experimentos sobre el modelo: estrategias de política, curva de Laffer emergente
// y Monte Carlo de "tasa de países quebrados".
import { createWorld, step, setPolicy } from './model.js';
import { DEFAULT_POLICY } from './config.js';

// Estrategias descritas por su contenido de política, no por etiqueta ideológica.
// La ideología la declara el jugador; el modelo solo ve palancas.
export const STRATEGIES = [
  { id: 'statu_quo', name: 'Statu quo', desc: 'Las palancas del año base, sin cambios. Déficit inicial de ~3% del PIB.', policy: {} },
  { id: 'estado_grande', name: 'Más impuestos y más gasto', desc: 'Sube renta, IVA, nómina, regalías, arancel y salario mínimo para pagar más gasto social y bienes públicos.',
    policy: { corpTax: 0.45, vat: 0.21, payrollTax: 0.12, royalty: 0.12, tariff: 0.12, regulation: 0.65, minWage: 1.0, transfers: 0.095, infra: 0.03, education: 0.055, security: 0.022, enforcement: 0.004 } },
  { id: 'estado_formal', name: 'Estado grande con base formal', desc: 'Mucho gasto social financiado con renta e IVA altos, pero baja la nómina y fortalece la DIAN.',
    policy: { corpTax: 0.40, vat: 0.22, payrollTax: 0.06, royalty: 0.12, tariff: 0.08, minWage: 0.95, transfers: 0.085, infra: 0.03, education: 0.05, security: 0.022, enforcement: 0.007 } },
  { id: 'estado_minimo', name: 'Estado mínimo', desc: 'Impuestos bajos, poco gasto, apertura comercial y desregulación.',
    policy: { corpTax: 0.22, vat: 0.16, payrollTax: 0.04, royalty: 0.06, tariff: 0.03, regulation: 0.25, minWage: 0.85, transfers: 0.035, infra: 0.02, education: 0.035, security: 0.018, enforcement: 0.002 } },
  { id: 'populismo', name: 'Populismo fiscal', desc: 'Baja impuestos y sube gasto y salario mínimo; financia con deuda y algo de emisión.',
    policy: { corpTax: 0.30, vat: 0.16, transfers: 0.11, infra: 0.035, education: 0.05, minWage: 1.08, tariff: 0.15, monetization: 0.01 } },
  { id: 'ortodoxo', name: 'Consolidación ortodoxa', desc: 'Recorta gasto para cerrar el déficit sin tocar impuestos.',
    policy: { transfers: 0.055, infra: 0.02, education: 0.042, security: 0.02, enforcement: 0.005 } },
  { id: 'pro_inversion', name: 'Pro-inversión estable', desc: 'Renta algo menor y estable, menos nómina, más IVA y fiscalización, más infraestructura y educación, menos subsidios.',
    policy: { corpTax: 0.32, vat: 0.20, payrollTax: 0.06, regulation: 0.3, tariff: 0.05, minWage: 0.9, infra: 0.032, education: 0.05, enforcement: 0.006, transfers: 0.058 } },
  { id: 'reformista', name: 'Reforma tributaria cada año', desc: 'Igual al statu quo, pero cambia impuestos al azar cada 4 trimestres.',
    policy: {}, dynamic: (w) => {
      if (w.t % 4 !== 0) return;
      const j = () => (w.rng.next() - 0.5) * 0.1;
      setPolicy(w, {
        corpTax: Math.min(0.55, Math.max(0.2, w.policy.corpTax + j())),
        vat: Math.min(0.25, Math.max(0.12, w.policy.vat + j() * 0.6)),
        payrollTax: Math.min(0.15, Math.max(0.03, w.policy.payrollTax + j() * 0.5)),
      });
    } },
];

export function runScenario({ seed, policy = {}, quarters = 40, dynamic = null }) {
  const w = createWorld({ seed, policy: { ...DEFAULT_POLICY, ...policy } });
  for (let i = 0; i < quarters; i++) {
    if (dynamic) dynamic(w);
    step(w);
  }
  return w;
}

export function summarize(w) {
  const h = w.hist;
  const last = h[h.length - 1];
  const avg = (key) => h.slice(1).reduce((a, r) => a + r[key], 0) / Math.max(1, h.length - 1);
  return {
    default: w.outcome.default != null,
    lostElection: w.outcome.lostElection != null,
    estallido: w.outcome.estallido != null,
    debtGDP: last.debtGDP,
    growth: (last.gdp / h[0].gdp) ** (4 / Math.max(1, h.length - 1)) - 1,
    u: avg('u'),
    informality: avg('informality'),
    poverty: avg('poverty'),
    inflation: avg('inflation'),
    approval: avg('approval'),
    relocated: last.relocatedTotal,
    firms: last.firms,
  };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// Monte Carlo: misma estrategia, distintos choques (semillas).
export async function monteCarlo({ strategies = STRATEGIES, runs = 40, quarters = 32, onProgress = null, customPolicy = null }) {
  const list = customPolicy ? [...strategies, { id: 'custom', name: 'Tu política actual', policy: customPolicy }] : strategies;
  const out = [];
  let done = 0;
  const total = list.length * runs;
  for (const s of list) {
    const res = [];
    for (let i = 0; i < runs; i++) {
      res.push(summarize(runScenario({ seed: 1000 + i, policy: s.policy, quarters, dynamic: s.dynamic })));
      done++;
      if (onProgress && done % 10 === 0) { onProgress(done / total); await new Promise((r) => setTimeout(r, 0)); }
    }
    const rate = (k) => res.filter((r) => r[k]).length / runs;
    out.push({
      id: s.id, name: s.name, desc: s.desc,
      defaultRate: rate('default'), lostElectionRate: rate('lostElection'), estallidoRate: rate('estallido'),
      anyCrisis: res.filter((r) => r.default || r.estallido).length / runs,
      debtGDP: median(res.map((r) => r.debtGDP)), growth: median(res.map((r) => r.growth)),
      u: median(res.map((r) => r.u)), informality: median(res.map((r) => r.informality)), poverty: median(res.map((r) => r.poverty)),
      inflation: median(res.map((r) => r.inflation)), approval: median(res.map((r) => r.approval)),
      relocated: median(res.map((r) => r.relocated)),
    });
  }
  return out;
}

// Curva de Laffer emergente: se barre una tasa y se mide el recaudo promedio de los últimos
// trimestres, dejando que las empresas respondan (informalidad, salida, relocalización).
export async function lafferScan({ key = 'corpTax', basePolicy = DEFAULT_POLICY, rates = null, seeds = 3, quarters = 32, onProgress = null }) {
  const grid = rates ?? Array.from({ length: 15 }, (_, i) => i * 0.05);
  const pts = [];
  let done = 0;
  for (const rate of grid) {
    let own = 0, total = 0, gdp = 0;
    for (let s = 0; s < seeds; s++) {
      const w = runScenario({ seed: 500 + s, policy: { ...basePolicy, [key]: rate, autopilot: true }, quarters });
      const tail = w.hist.slice(-8);
      const field = { corpTax: 'corp', vat: 'vat', payrollTax: 'payroll', royalty: 'royalty', tariff: 'tariff' }[key];
      // recaudo en nivel (billones/año) para que la caída de la base sea visible
      own += tail.reduce((a, r) => a + r[field] * r.gdp, 0) / tail.length;
      total += tail.reduce((a, r) => a + (r.corp + r.vat + r.payroll + r.royalty + r.tariff + r.other) * r.gdp, 0) / tail.length;
      gdp += tail.reduce((a, r) => a + r.gdp, 0) / tail.length;
      done++;
      if (onProgress) { onProgress(done / (grid.length * seeds)); await new Promise((r) => setTimeout(r, 0)); }
    }
    pts.push({ rate, own: own / seeds, total: total / seeds, gdp: gdp / seeds });
  }
  return { key, pts, fit: fitQuadratic(pts.map((p) => p.rate), pts.map((p) => p.own)) };
}

// Ajuste R(τ) = a·τ + b·τ² por mínimos cuadrados (pasa por el origen); pico en τ* = -a / 2b.
export function fitQuadratic(xs, ys) {
  let s2 = 0, s3 = 0, s4 = 0, sy1 = 0, sy2 = 0;
  xs.forEach((x, i) => { s2 += x * x; s3 += x ** 3; s4 += x ** 4; sy1 += x * ys[i]; sy2 += x * x * ys[i]; });
  const det = s2 * s4 - s3 * s3;
  if (Math.abs(det) < 1e-12) return null;
  const a = (sy1 * s4 - sy2 * s3) / det;
  const b = (s2 * sy2 - s3 * sy1) / det;
  return { a, b, peak: b < 0 ? -a / (2 * b) : null };
}
