// Motor de simulación de Broken Countries.
// Un trimestre = un paso. Las ecuaciones están documentadas en docs/MODELO.md.
import { REGIONS, SECTORS, SECTOR_KEYS, TAX_KEYS, SPEND_KEYS, DEFAULT_POLICY, NEIGHBOR, P } from './config.js';
import { makeRng } from './rng.js';
import { solveCournot } from './cournot.js';
import * as Debt from './debt.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const sum = (a) => a.reduce((x, y) => x + y, 0);

export const regionFactor = (r, sens = 1) => (r.infra ** -P.phiInfra * r.hc ** -P.phiHc * r.sec ** -P.phiSec) ** sens;
export const marketWage = (r) => Math.sqrt(r.hc);
const growthFactor = (w) => (1 + P.gM) ** w.t;

// Dónde nacen las empresas de cada sector (peso por región).
const LOCATION = {
  agro: (r) => r.pop + 0.08,
  manufactura: (r) => r.pop * r.infra ** 2,
  tecnologia: (r) => r.pop * r.hc ** 4,
  mineria: (r) => r.res,
};

// ---------------------------------------------------------------- empresas

function newFirm(w, sector, region, A) {
  return { id: w.nextId++, sector, region, A, e: 0.3, c: 1, base: 1, mw: 1, q: 0, price: 0, sales: 0, profit: 0, piHat: 0, lossStreak: 0, age: 0, cap: 0 };
}

// Costo marginal: capital (sensible al costo de financiarse), trabajo (salario mínimo,
// prestaciones, parafiscales), costo esperado de ser informal y trámites.
function firmCost(w, f) {
  const S = SECTORS[f.sector], r = w.regions[f.region], pol = w.policy;
  const base = (regionFactor(r, S.regionSens) / f.A) * (S.unitCost ?? 1);
  const mw = Math.max(1, pol.minWage / marketWage(r));
  const lc = (1 - f.e) * mw * (1 + P.nonWageCost + pol.payrollTax) + f.e;
  const enf = enforcementCost(w);
  const unit = (1 - S.lambda) * (1 + S.kappa * (userCost(r.rcap, pol.corpTax * (1 - f.e)) - P.rRef))
    + (S.lambda * lc) / P.lcRef
    + enf * f.e + 0.5 * P.inf.theta * f.e * f.e
    + P.regCost * pol.regulation;
  f.base = base;
  f.mw = mw;
  return base * unit;
}

// Costo de uso del capital (Hall–Jorgenson): el impuesto de renta encarece invertir,
// atenuado por las deducciones por depreciación.
function userCost(r, tax) {
  return (r * (1 - tax * P.depAllow)) / (1 - tax);
}

// Traslado de utilidades al vecino (precios de transferencia): crece con la brecha de tasas.
function profitShifting(pol, S) {
  const reach = { tradable: 1, local: 0.4, commodity: 0.3 }[S.kind];
  return clamp(P.shift * reach * (pol.corpTax - NEIGHBOR.corpTax), 0, 0.6);
}

// Costo esperado (por unidad de informalidad) de que la DIAN lo detecte; rendimientos decrecientes.
function enforcementCost(w) {
  return P.inf.s0 + P.inf.kEnf * P.inf.enfRef * Math.sqrt(w.exec.enforcement / P.inf.enfRef);
}

// Informalidad óptima: ahorro marginal de no cumplir vs. costo esperado de que lo pillen.
function chooseInformality(w, f, margin) {
  const S = SECTORS[f.sector], r = w.regions[f.region], pol = w.policy;
  const mw = Math.max(1, pol.minWage / marketWage(r));
  const laborSaving = (S.lambda * (mw * (1 + P.nonWageCost + pol.payrollTax) - 1)) / P.lcRef;
  const taxSaving = pol.corpTax * Math.max(0, margin) + (S.kind === 'commodity' ? 0 : pol.vat * P.consShare * 0.5);
  const target = (laborSaving + taxSaving - enforcementCost(w)) / P.inf.theta;
  return clamp(target, 0, S.emax);
}

function neighborCost(w, f) {
  const S = SECTORS[f.sector];
  const unit = (1 - S.lambda) * (1 + S.kappa * (userCost(w.macro.rf + NEIGHBOR.riskPremium, NEIGHBOR.corpTax) - P.rRef))
    + (S.lambda * NEIGHBOR.laborCost) / P.lcRef;
  return (NEIGHBOR.regionFactor / f.A) * unit;
}

// Probabilidad trimestral de que una empresa transable se mude al país vecino.
function relocationProb(w, f) {
  const S = SECTORS[f.sector], r = w.regions[f.region], pol = w.policy, m = w.macro;
  const g = growthFactor(w);
  const Vd = (f.piHat * (1 - pol.corpTax * (1 - f.e))) / (r.rcap / 4 + 0.02);
  const cn = neighborCost(w, f) * m.fxReal;
  const Pn = (f.price * (1 - NEIGHBOR.transport)) / (1 + pol.tariff);
  const pin = (Pn - cn) * f.q - w.sectors[f.sector].fixed * g;
  const Vn = (pin * (1 - NEIGHBOR.corpTax)) / ((m.rf + NEIGHBOR.riskPremium) / 4 + 0.02);
  const VnNet = Vn * (1 - S.mobility);
  if (VnNet <= 0) return 0;
  if (Vd <= 0) return 0.25;
  const x = VnNet / Vd - 1;
  return P.reloc.hmax * sigmoid((x - P.reloc.threshold) / P.reloc.width);
}

// ---------------------------------------------------------------- creación y calibración

export function createWorld({ seed = 1, policy = {} } = {}) {
  const rng = makeRng(seed);
  const piT = P.inflTargetA / 4;
  const w = {
    seed, rng, t: 0, nextId: 1, nextLenderId: 1,
    // El año base siempre se calibra con la política de referencia; la del jugador se aplica después.
    policy: { ...DEFAULT_POLICY },
    regions: REGIONS.map((r, idx) => ({ ...r, idx, infra0: r.infra, hc0: r.hc, sec0: r.sec, d: 1, u: P.targetUnemployment, informality: 0, lf: r.pop, lfShare: r.pop, income: 1, income0: 1, rcap: 0.06, Mserv: 0, firms: 0 })),
    firms: [], relocated: [], sectors: {}, markets: {},
    macro: {
      cpi: 1, fx: 1, fxReal: 1, worldCpi: 1, commodityLog: 0, commodity: 1, prevCommodity: 1, rf: P.rf0,
      inflQ: piT, inflA: P.inflTargetA, inflExpA: P.inflTargetA, inflHist: [piT, piT, piT, piT],
      realWage: 1, approval: 0.45, gdpReal: 1, gdpTrendReal: 1, gdpHist: [], deficitGDP: 0.05,
      policyVol: 0, taxShock: 0, creditCrunch: 0, fxShockNext: 0, lastDep: 0, prevSpread: 0.022, monetQ: 0,
      lowStreak: 0, uNat: P.targetUnemployment, growthYoY: 0,
    },
    exec: {}, austerity: 0,
    calib: { laborScale: [], logA0: {}, otherRev: 0, formal0: 0.5, K0: {}, display: 1 },
    flow: { entries: 0, exits: 0, relocations: 0 }, totals: { entries: 0, exits: 0, relocations: 0 },
    hist: [], events: [], outcome: { default: null, lostElection: null, estallido: null },
    policyHist: [], lenders: [], debt: null,
  };
  w.log = (kind, text) => {
    w.events.push({ t: w.t, kind, text });
    if (w.events.length > 400) w.events.shift();
  };

  const norm = sum(w.regions.map((r) => r.pop * r.hc));
  for (const r of w.regions) r.Mserv = (SECTORS.servicios.share * P.marketScale * r.pop * r.hc) / norm;
  for (const k of SECTOR_KEYS) {
    const S = SECTORS[k];
    w.sectors[k] = { barrier: 0.15, M: S.share * P.marketScale, sTypical: 1, fixed: 0, capTypical: 0, lerner: 0, hhi: 0, importShare: 0, importQ: 0, importBill: 0, price: 1, n: 0, entries: 0, exits: 0, relocs: 0, entryBarrier: 0 };
  }

  // Empresas iniciales
  for (const k of ['agro', 'manufactura', 'tecnologia', 'mineria']) {
    const S = SECTORS[k];
    for (let i = 0; i < S.n0; i++) {
      const ri = rng.pick(w.regions.map(LOCATION[k]));
      const f = newFirm(w, k, ri, Math.exp(0.08 * rng.normal()));
      if (k === 'mineria') f.cap = (w.sectors[k].M / S.n0) * Math.exp(0.3 * rng.normal());
      w.firms.push(f);
    }
  }
  for (const r of w.regions) {
    const n = Math.round(10 + 90 * r.pop);
    for (let i = 0; i < n; i++) w.firms.push(newFirm(w, 'servicios', r.idx, Math.exp(0.08 * rng.normal())));
  }

  // Calibración: precios, PIB, empleo y recaudo del año base
  w.exec = execSpending(w);
  for (const r of w.regions) r.rcap = w.macro.rf + P.cap.spreadPass * 0.022 + P.cap.security * (1 - r.sec);
  for (const f of w.firms) { f.e = chooseInformality(w, f, 0.08); f.c = firmCost(w, f); }
  for (const k of SECTOR_KEYS) w.calib.K0[k] = 10; // sin importaciones mientras se depura
  // Se descartan las empresas que no serían viables en el año base y se deja que la
  // informalidad se acomode, hasta llegar a un equilibrio donde todas producen con ganancia.
  for (let it = 0; it < 12; it++) {
    clearMarkets(w);
    for (const k of SECTOR_KEYS) {
      const list = w.firms.filter((f) => f.sector === k && f.q > 0);
      const sec = w.sectors[k];
      sec.sTypical = sum(list.map((f) => f.sales)) / Math.max(1, list.length);
      sec.fixed = SECTORS[k].fixed * sec.sTypical;
      if (k === 'mineria') sec.capTypical = sum(list.map((f) => f.cap)) / Math.max(1, list.length);
    }
    w.firms = w.firms.filter((f) => f.q > 0 && f.profit > 0);
    for (const f of w.firms) { f.e = chooseInformality(w, f, f.profit / f.sales); f.c = firmCost(w, f); }
    calibrateImports(w);
  }
  clearMarkets(w);
  // Frontera tecnológica de los entrantes: productividad media de las empresas del año base.
  for (const k of SECTOR_KEYS) {
    const inc = w.firms.filter((f) => f.sector === k);
    w.calib.logA0[k] = inc.length ? sum(inc.map((f) => Math.log(f.A))) / inc.length : 0;
  }
  let fl = accounting(w);
  const ex = w.exec;
  const govShare = ex.infra + ex.education + ex.security + ex.enforcement + ex.competition + 0.5 * P.inflexibleSpending;
  w.macro.gdpTrendReal = fl.privVA / (1 - govShare);
  fl = accounting(w);
  w.macro.gdpReal = fl.gdpReal;
  w.macro.gdpHist = [fl.gdpReal, fl.gdpReal, fl.gdpReal, fl.gdpReal];
  w.calib.laborScale = w.regions.map((r, i) => ((1 - r.u0 / (1 - P.subsistence)) * r.lf) / (fl.jobs[i] + fl.pubJobs[i]));
  w.calib.formal0 = 1 - fl.informality;  // informalidad dentro de las empresas
  w.calib.otherRev = P.targetRevenue - fl.taxReal / fl.gdpReal;
  w.calib.display = P.displayGDP / (4 * fl.gdpReal);
  fl = accounting(w);
  updateRegions(w, fl, true);
  w.calib.informality0 = sum(w.regions.map((r) => r.informality * r.lf)) / sum(w.regions.map((r) => r.lf));
  w.macro.informality = w.calib.informality0;
  w.macro.poverty = P.poverty0;
  for (const f of w.firms) f.piHat = f.profit;
  Debt.initDebt(w);
  record(w, fl, true);
  Object.assign(w.policy, policy);
  w.policyHist.push(snapshot(w.policy));
  return w;
}

// Costo de los importados (antes de arancel) que reproduce la penetración de importaciones del año base.
function calibrateImports(w) {
  const pol = w.policy;
  for (const k of SECTOR_KEYS) {
    const S = SECTORS[k];
    if (S.kind !== 'tradable') continue;
    const dom = w.firms.filter((f) => f.sector === k).map((f) => f.c);
    const M = w.sectors[k].M;
    const A = P.demandA / (1 + pol.vat), B = (P.demandA - 1) / M / (1 + pol.vat);
    let lo = 0.3, hi = 3;
    for (let it = 0; it < 40; it++) {
      const k0 = 0.5 * (lo + hi);
      const res = solveCournot(A, B, dom.concat(new Array(S.nForeign).fill(k0 * (1 + pol.tariff))));
      const imp = res.Q > 0 ? sum(res.q.slice(dom.length)) / res.Q : 0;
      if (imp > S.import0) lo = k0; else hi = k0;
    }
    w.calib.K0[k] = 0.5 * (lo + hi);
  }
}

function execSpending(w) {
  const e = {};
  for (const k of SPEND_KEYS) e[k] = w.policy[k] * (k === 'enforcement' || k === 'competition' ? 1 : 1 - w.austerity);
  return e;
}

function snapshot(pol) {
  const s = {};
  for (const k of [...TAX_KEYS, 'minWage']) s[k] = pol[k];
  return s;
}

// ---------------------------------------------------------------- paso trimestral

export function step(w) {
  w.t += 1;
  exogenous(w);
  prepare(w);
  clearMarkets(w);
  const fl = accounting(w);
  government(w, fl);
  updateMacro(w, fl);
  updateRegions(w, fl);
  firmDynamics(w);
  updateBarriers(w);
  Debt.defaultDynamics(w);
  Debt.lenderDynamics(w);
  updateApproval(w, fl);
  record(w, fl);
  w.policyHist.push(snapshot(w.policy));
  return w;
}

export function run(w, n) {
  for (let i = 0; i < n; i++) step(w);
  return w;
}

function exogenous(w) {
  const m = w.macro, rng = w.rng;
  m.prevCommodity = m.commodity;
  m.commodityLog = 0.93 * m.commodityLog + 0.06 * rng.normal();
  m.commodity = Math.exp(m.commodityLog);
  if (m.commodity / m.prevCommodity > 1.15) w.log('externo', `Bonanza: el precio del petróleo y los minerales sube ${Math.round((m.commodity / m.prevCommodity - 1) * 100)}%.`);
  if (m.commodity / m.prevCommodity < 0.87) w.log('externo', `Choque externo: el precio del petróleo y los minerales cae ${Math.round((1 - m.commodity / m.prevCommodity) * 100)}%.`);
  const rfPrev = m.rf;
  m.rf = clamp(P.rf0 + 0.92 * (m.rf - P.rf0) + 0.0025 * rng.normal(), 0.005, 0.10);
  if (m.rf - rfPrev > 0.005) w.log('externo', 'La Reserva Federal sube tasas: el capital global se encarece.');
}

function policyVolatility(w) {
  const h = w.policyHist;
  let ss = 0;
  for (let i = Math.max(1, h.length - 12); i < h.length; i++) {
    for (const k of TAX_KEYS) ss += (h[i][k] - h[i - 1][k]) ** 2;
    ss += 0.25 * (h[i].minWage - h[i - 1].minWage) ** 2;
  }
  return Math.sqrt(ss);
}

function taxShock(w) {
  const h = w.policyHist;
  let s = 0;
  for (let i = Math.max(1, h.length - 4); i < h.length; i++) {
    for (const k of ['corpTax', 'vat', 'payrollTax']) s += Math.max(0, h[i][k] - h[i - 1][k]);
  }
  return s;
}

function prepare(w) {
  const m = w.macro, d = w.debt, pol = w.policy;
  m.policyVol = policyVolatility(w);
  m.taxShock = taxShock(w);
  w.exec = execSpending(w);
  // Pignorar recursos: una vez comprometidos, quedan amarrados 5 años.
  if (pol.pledge && !d.pledged) { d.pledged = true; d.pledgeUntil = w.t + 20; w.log('deuda', 'Se pignoran las regalías como garantía de la deuda.'); }
  if (!pol.pledge && d.pledged && w.t >= d.pledgeUntil && d.status === 'normal') d.pledged = false;
  const spread = d.status === 'normal' ? d.spread : 0.15;
  for (const r of w.regions) {
    r.rcap = m.rf + P.cap.spreadPass * spread + P.cap.policyVol * m.policyVol + P.cap.security * (1 - r.sec) + m.creditCrunch;
  }
  for (const f of w.firms) f.c = firmCost(w, f);
}

function nationalDemand(w) {
  return sum(w.regions.map((r) => r.d * r.income0)) / sum(w.regions.map((r) => r.income0));
}

function setOutput(w, f, price, q, g) {
  f.price = price;
  f.q = q;
  f.sales = price * q;
  f.profit = (price - f.c) * q - w.sectors[f.sector].fixed * g;
}

// Mercados: Cournot nacional con importaciones (transables), Cournot regional (servicios),
// tomadores de precio (minería).
function clearMarkets(w) {
  const pol = w.policy, m = w.macro, g = growthFactor(w), vatF = 1 + pol.vat;
  const bySector = Object.fromEntries(SECTOR_KEYS.map((k) => [k, []]));
  for (const f of w.firms) bySector[f.sector].push(f);
  const dNat = nationalDemand(w);
  w.markets = {};
  for (const k of SECTOR_KEYS) {
    const S = SECTORS[k], sec = w.sectors[k], list = bySector[k];
    sec.n = list.length;
    if (S.kind === 'tradable') {
      const rel = w.relocated.filter((f) => f.sector === k);
      const cF = w.calib.K0[k] * m.fxReal * (1 + pol.tariff);
      const relC = rel.map((f) => (neighborCost(w, f) * m.fxReal * (1 + pol.tariff)) / (1 - NEIGHBOR.transport));
      const costs = list.map((f) => f.c).concat(new Array(S.nForeign).fill(cF), relC);
      const M = sec.M * g * dNat;
      const A = P.demandA / vatF, B = (P.demandA - 1) / M / vatF;
      const res = solveCournot(A, B, costs);
      list.forEach((f, i) => setOutput(w, f, res.P, res.q[i], g));
      rel.forEach((f, i) => { f.q = res.q[list.length + S.nForeign + i]; f.price = res.P; });
      let impQ = 0, impBill = 0;
      for (let j = list.length; j < costs.length; j++) { impQ += res.q[j]; impBill += res.q[j] * costs[j]; }
      sec.importQ = impQ;
      sec.importBill = impBill;
      sec.price = res.P;
      sec.importShare = res.Q > 0 ? impQ / res.Q : 0;
      sec.hhi = res.Q > 0 ? sum(res.q.map((q) => (q / res.Q) ** 2)) * 10000 : 10000;
      w.markets[k] = { A, B, costs };
    } else if (S.kind === 'local') {
      let hhiW = 0, Qtot = 0, pq = 0;
      for (const r of w.regions) {
        const loc = list.filter((f) => f.region === r.idx);
        const M = r.Mserv * g * r.d;
        const A = P.demandA / vatF, B = (P.demandA - 1) / M / vatF;
        const costs = loc.map((f) => f.c);
        const res = solveCournot(A, B, costs);
        loc.forEach((f, i) => setOutput(w, f, res.P, res.q[i], g));
        if (res.Q > 0) {
          hhiW += sum(res.q.map((q) => (q / res.Q) ** 2)) * 10000 * res.Q;
          Qtot += res.Q;
          pq += res.P * res.Q;
        }
        w.markets[`${k}:${r.idx}`] = { A, B, costs };
      }
      sec.hhi = Qtot > 0 ? hhiW / Qtot : 10000;
      sec.price = Qtot > 0 ? pq / Qtot : 0;
      sec.importShare = 0; sec.importQ = 0; sec.importBill = 0;
    } else {
      const Ps = m.commodity * m.fxReal;
      for (const f of list) setOutput(w, f, Ps, f.c < Ps ? f.cap : 0, g);
      const Q = sum(list.map((f) => f.q));
      sec.price = Ps;
      sec.hhi = Q > 0 ? sum(list.map((f) => (f.q / Q) ** 2)) * 10000 : 10000;
      sec.importShare = 0; sec.importQ = 0; sec.importBill = 0;
    }
    let rent = 0, rev = 0;
    for (const f of list) { rent += (f.price - f.c) * f.q; rev += f.price * f.q; }
    sec.lerner = rev > 0 ? rent / rev : 0;
  }
}

// Cuentas del trimestre: salarios, empleo, impuestos y valor agregado (en términos reales).
function accounting(w) {
  const pol = w.policy, m = w.macro, R = w.regions.length, ex = w.exec;
  const z = () => new Array(R).fill(0);
  const fl = { corp: 0, vat: 0, payroll: 0, royalty: 0, tariff: 0, other: 0, privVA: 0, jobs: z(), infJobs: z(), wages: z(), profitsHH: z(), pubJobs: z(), pubWages: z(), transfers: z(), sectorVA: {} };
  for (const f of w.firms) {
    const S = SECTORS[f.sector], r = w.regions[f.region];
    const wageMkt = S.lambda * f.base * f.q;
    const formal = (1 - f.e) * f.mw * wageMkt;
    fl.payroll += pol.payrollTax * formal;
    fl.wages[f.region] += formal * (1 + P.nonWageCost) + f.e * wageMkt;
    const jobs = wageMkt / marketWage(r);
    fl.jobs[f.region] += jobs;
    fl.infJobs[f.region] += f.e * jobs;
    const corp = pol.corpTax * (1 - f.e) * (1 - profitShifting(pol, S)) * Math.max(0, f.profit);
    const roy = S.kind === 'commodity' ? pol.royalty * f.sales : 0;
    fl.corp += corp;
    fl.royalty += roy;
    if (S.kind !== 'commodity') fl.vat += pol.vat * f.sales * (1 - f.e) * P.consShare;
    fl.profitsHH[f.region] += 0.5 * Math.max(0, f.profit - corp - roy);
    const va = f.sales * S.va;
    fl.privVA += va;
    fl.sectorVA[f.sector] = (fl.sectorVA[f.sector] || 0) + va;
  }
  for (const k of SECTOR_KEYS) {
    const sec = w.sectors[k];
    if (SECTORS[k].kind !== 'tradable') continue;
    fl.tariff += (pol.tariff / (1 + pol.tariff)) * sec.importBill;
    fl.vat += pol.vat * sec.price * sec.importQ * P.consShare;
  }
  const govShare = ex.infra + ex.education + ex.security + ex.enforcement + ex.competition + 0.5 * P.inflexibleSpending;
  fl.govVA = govShare * m.gdpTrendReal;
  fl.gdpReal = fl.privVA + fl.govVA;
  w.regions.forEach((r, i) => {
    fl.pubWages[i] = fl.govVA * 0.6 * r.pop;
    fl.pubJobs[i] = fl.pubWages[i] / marketWage(r);
    fl.transfers[i] = ex.transfers * m.gdpTrendReal * r.pop;
  });
  const jobs = sum(fl.jobs);
  fl.informality = jobs > 0 ? sum(fl.infJobs) / jobs : 0;
  fl.other = w.calib.otherRev * fl.gdpReal * ((1 - fl.informality) / w.calib.formal0);
  fl.taxReal = fl.corp + fl.vat + fl.payroll + fl.royalty + fl.tariff + fl.other;
  return fl;
}

// Presupuesto del gobierno y financiamiento.
function government(w, fl) {
  const m = w.macro, d = w.debt, pol = w.policy, ex = w.exec, cpi = m.cpi;
  const gdpN = fl.gdpReal * cpi, trendN = m.gdpTrendReal * cpi;
  const seized = d.pledged && d.status !== 'normal' ? fl.royalty : 0;
  const revenue = (fl.taxReal - seized) * cpi;
  const disc = (ex.transfers + ex.infra + ex.education + ex.security) * trendN;
  const fixedSp = (ex.enforcement + ex.competition + P.inflexibleSpending) * trendN;
  const monet = pol.monetization * trendN;
  let interest = Debt.interestDue(w);
  let netNeed = disc + fixedSp + interest - revenue - monet;
  const q = Debt.quote(w, netNeed);
  if (q.shortfall > 0 && d.status === 'normal' && q.shortfall > 0.4 * disc) {
    Debt.declareDefault(w, 'nadie quiere refinanciar la deuda (crisis de rollover).');
    interest = Debt.interestDue(w);
    netNeed = disc + fixedSp + interest - revenue - monet;
  }
  let cut = 0, forced = 0;
  if (d.status === 'normal') {
    cut = Math.min(q.shortfall, 0.4 * disc);
    Debt.issue(w, netNeed - cut, q);
  } else {
    const need = Math.max(0, netNeed);
    cut = Math.min(need, 0.4 * disc);
    forced = need - cut;
    if (d.status === 'holdouts') Debt.issue(w, netNeed, q);
  }
  const aust = disc > 0 ? cut / disc : 0;
  if (aust > 0.02) w.log('fiscal', `Recorte de emergencia del ${Math.round(aust * 100)}% del gasto discrecional: no alcanza el financiamiento.`);
  if (forced > 0.002 * gdpN) w.log('fiscal', 'El banco central imprime dinero para pagar lo que el mercado no financia.');
  w.austerity = Math.max(w.austerity * 0.5, aust);
  if (aust > 0) for (const k of ['transfers', 'infra', 'education', 'security']) ex[k] *= 1 - aust;
  fl.cpi = cpi;
  fl.gdpN = gdpN;
  fl.revenue = revenue;
  fl.spending = disc - cut + fixedSp;
  fl.interest = interest;
  fl.monet = monet + forced;
  fl.seized = seized * cpi;
  fl.deficit = fl.spending + interest - revenue;
  m.monetQ = fl.monet / gdpN;
  m.deficitGDP = 0.75 * m.deficitGDP + 0.25 * (fl.deficit / gdpN);
}

function updateMacro(w, fl) {
  const m = w.macro, rng = w.rng, d = w.debt;
  const piT = P.inflTargetA / 4;
  const dNat = nationalDemand(w);
  m.inflQ = clamp(piT + 0.4 * (m.inflQ - piT) + 1.0 * m.monetQ + 0.25 * m.lastDep + 0.08 * (dNat - 1) + 0.002 * rng.normal(), -0.005, 0.6);
  m.cpi *= 1 + m.inflQ;
  m.inflHist.push(m.inflQ);
  if (m.inflHist.length > 4) m.inflHist.shift();
  m.inflA = m.inflHist.reduce((a, x) => a * (1 + x), 1) - 1;
  const s = d.status === 'normal' ? d.spread : 0.25;
  const dep = (m.inflQ - P.worldInflQ) + 0.6 * (s - m.prevSpread)
    - 0.25 * (Math.log(m.commodity) - Math.log(m.prevCommodity))
    + 0.4 * m.monetQ + m.fxShockNext - 0.05 * Math.log(m.fxReal) + 0.012 * rng.normal();
  m.fxShockNext = 0;
  m.prevSpread = s;
  m.fx *= Math.exp(dep);
  m.worldCpi *= 1 + P.worldInflQ;
  m.fxReal = (m.fx * m.worldCpi) / m.cpi;
  m.lastDep = dep;
  m.realWage = clamp(m.realWage + 0.15 * (1 - m.realWage) - 0.5 * (m.inflQ - piT), 0.5, 1.1);
  m.inflExpA = 0.7 * m.inflExpA + 0.3 * m.inflA;
  m.creditCrunch *= 0.85;
  m.gdpReal = fl.gdpReal;
  m.gdpTrendReal = 0.7 * m.gdpTrendReal * (1 + P.gM) + 0.3 * fl.gdpReal;
  m.gdpHist.push(fl.gdpReal);
  if (m.gdpHist.length > 8) m.gdpHist.shift();
}

function updateRegions(w, fl, calibrating = false) {
  const m = w.macro, ex = w.exec, g = growthFactor(w);
  const income = (r, i) => (fl.wages[i] + fl.pubWages[i]) * m.realWage + fl.transfers[i] + fl.profitsHH[i];
  const natRatio = sum(w.regions.map(income)) / sum(w.regions.map((r) => r.yTrend));
  w.regions.forEach((r, i) => {
    // Quien no consigue empleo en una empresa o en el Estado: una parte se rebusca
    // (informalidad de subsistencia) y el resto queda desempleado.
    const jobs = (fl.jobs[i] + fl.pubJobs[i]) * w.calib.laborScale[i];
    r.lf = r.lfShare * sum(w.regions.map((x) => x.pop)) * (1 + P.gLF) ** w.t;
    const out = clamp(1 - jobs / r.lf, 0, 0.9);
    r.u = clamp((1 - P.subsistence) * out, 0.02, 0.5);
    const firmJobs = fl.jobs[i] * w.calib.laborScale[i];
    r.informality = (fl.infJobs[i] * w.calib.laborScale[i] + P.subsistence * out * r.lf) / Math.max(1e-9, firmJobs + P.subsistence * out * r.lf);
    r.income = income(r, i);
    if (calibrating) { r.income0 = r.income; r.yTrend = r.income; return; }
    // Demanda keynesiana transitoria: responde al ingreso frente a su tendencia, no al nivel.
    r.yTrend = (1 - P.trendSpeed) * r.yTrend * (1 + P.gM) + P.trendSpeed * r.income;
    const ratio = 0.5 * (r.income / r.yTrend) + 0.5 * natRatio;
    r.d = clamp(0.8 * r.d + 0.2 * (1 + P.incomeElasticity * (ratio - 1)), 0.6, 1.4);
    r.infra += P.infraSpeed * (r.infra0 * Math.sqrt(ex.infra / P.spendRef.infra) - r.infra);
    r.hc += P.hcSpeed * (r.hc0 * Math.sqrt(ex.education / P.spendRef.education) - r.hc);
    r.sec += P.secSpeed * (r.sec0 * Math.sqrt(ex.security / P.spendRef.security) - r.sec);
    r.sec = clamp(r.sec, 0.05, 1.2);
  });
  if (!calibrating) {
    // Migración interna lenta hacia regiones con menos desempleo.
    const uNat = sum(w.regions.map((r) => r.u * r.lf)) / sum(w.regions.map((r) => r.lf));
    for (const r of w.regions) r.lfShare *= 1 + P.migration * (uNat - r.u);
    const tot = sum(w.regions.map((r) => r.lfShare));
    for (const r of w.regions) r.lfShare /= tot;
  }
  w.regions.forEach((r) => { r.firms = 0; });
  for (const f of w.firms) w.regions[f.region].firms++;
}

// Entrada, salida, informalidad, productividad y relocalización de empresas.
function firmDynamics(w) {
  const rng = w.rng;
  const flow = (w.flow = { entries: 0, exits: 0, relocations: 0 });
  const relocBySector = {};
  for (const k of SECTOR_KEYS) Object.assign(w.sectors[k], { entries: 0, exits: 0, relocs: 0 });
  const keep = [];
  for (const f of w.firms) {
    const S = SECTORS[f.sector], r = w.regions[f.region], sec = w.sectors[f.sector];
    f.age++;
    f.piHat = 0.6 * f.piHat + 0.4 * f.profit;
    f.lossStreak = f.piHat < 0 ? f.lossStreak + 1 : 0;
    const margin = f.sales > 0 ? f.profit / f.sales : 0;
    f.e += 0.5 * (chooseInformality(w, f, margin) - f.e);
    if (S.kind === 'commodity') f.cap *= 1 - P.depletion;
    f.A *= Math.exp(P.growthHc * (r.hc - 0.85) + P.growthInfra * (r.infra - 0.8) + 0.006 * rng.normal());
    if (f.lossStreak >= P.exitStreak || rng.next() < P.firmDeath) { sec.exits++; flow.exits++; continue; }
    if (S.kind === 'tradable' && rng.next() < relocationProb(w, f)) {
      sec.relocs++;
      flow.relocations++;
      relocBySector[f.sector] = (relocBySector[f.sector] || 0) + 1;
      w.relocated.push(f);
      continue;
    }
    keep.push(f);
  }
  w.firms = keep;
  w.relocated = w.relocated.filter(() => rng.next() > 0.02);
  for (const [k, n] of Object.entries(relocBySector)) {
    w.log('empresas', `${n} empresa${n > 1 ? 's' : ''} de ${SECTORS[k].name.toLowerCase()} se ${n > 1 ? 'fueron' : 'fue'} al ${'país vecino'}.`);
  }
  entry(w);
  w.totals.entries += flow.entries;
  w.totals.exits += flow.exits;
  w.totals.relocations += flow.relocations;
}

// Entrantes potenciales: entran si el valor esperado después de entrar supera la barrera.
function entry(w) {
  const m = w.macro, pol = w.policy, rng = w.rng, g = growthFactor(w);
  for (const k of SECTOR_KEYS) {
    const S = SECTORS[k], sec = w.sectors[k];
    const logA = w.calib.logA0[k] + P.frontierGrowth * w.t;
    const mult = 1 + 2 * pol.regulation + sec.barrier;
    const F = S.entryCost * sec.sTypical * g * mult;
    sec.entryBarrier = S.entryCost * mult;
    const tries = [];
    if (S.kind === 'local') {
      for (const r of w.regions) {
        const n = rng.poisson(S.entryRate * (0.4 + 3 * r.pop));
        for (let i = 0; i < n; i++) tries.push(r.idx);
      }
    } else {
      const n = rng.poisson(S.kind === 'commodity' ? S.entryRate * m.commodity : S.entryRate);
      for (let i = 0; i < n; i++) tries.push(rng.pick(w.regions.map(LOCATION[k])));
    }
    for (const ri of tries) {
      const f = newFirm(w, k, ri, Math.exp(logA - 0.02 + P.entrantSigma * rng.normal()));
      if (S.kind === 'commodity') f.cap = sec.capTypical * Math.sqrt(g) * Math.exp(0.3 * rng.normal());
      f.e = chooseInformality(w, f, 0.06);
      f.c = firmCost(w, f);
      let pi, mk = null;
      if (S.kind === 'commodity') {
        pi = Math.max(0, m.commodity * m.fxReal - f.c) * f.cap - sec.fixed * g;
      } else {
        mk = w.markets[S.kind === 'local' ? `${k}:${ri}` : k];
        if (!mk) continue;
        const res = solveCournot(mk.A, mk.B, mk.costs.concat([f.c]));
        pi = (res.P - f.c) * res.q[res.q.length - 1] - sec.fixed * g;
      }
      const V = (pi * (1 - pol.corpTax * (1 - f.e))) / (w.regions[ri].rcap / 4 + 0.02);
      if (V > F) {
        f.piHat = pi;
        w.firms.push(f);
        sec.entries++;
        w.flow.entries++;
        if (mk) mk.costs.push(f.c);
      }
    }
  }
}

// Captura regulatoria: los sectores con márgenes altos presionan por más barreras.
function updateBarriers(w) {
  const comp = w.exec.competition;
  const eff = comp / (comp + 0.0005);
  for (const k of SECTOR_KEYS) {
    if (k === 'mineria') continue;
    const sec = w.sectors[k];
    sec.barrier = clamp(sec.barrier * (1 - P.lobby.decay) + P.lobby.gain * Math.max(0, sec.lerner - P.lobby.threshold) * (1 - eff), 0, 3);
  }
}

function updateApproval(w, fl) {
  const m = w.macro, ex = w.exec, d = w.debt;
  const lf = sum(w.regions.map((r) => r.lf));
  m.uNat = sum(w.regions.map((r) => r.u * r.lf)) / lf;
  const h = m.gdpHist;
  m.growthYoY = h.length >= 5 ? fl.gdpReal / h[h.length - 5] - 1 : 0;
  m.informality = sum(w.regions.map((r) => r.informality * r.lf)) / lf;
  // Pobreza monetaria: sube con desempleo, informalidad e inflación; baja con transferencias.
  m.poverty = clamp(P.poverty0 + 0.9 * (m.uNat - P.targetUnemployment) + 0.4 * (m.informality - w.calib.informality0)
    + 0.3 * Math.max(0, m.inflA - 0.04) - 2.5 * (ex.transfers - 0.07) - 0.5 * (m.realWage - 1), 0.05, 0.8);
  const x = -10 * (m.uNat - P.targetUnemployment)
    - 6 * (m.poverty - P.poverty0)
    - 5 * (m.inflA - 0.04)
    + 4 * (m.growthYoY - 0.025)
    + 4 * (ex.transfers - 0.07)
    + 3 * (ex.infra + ex.education + ex.security - 0.09)
    - 5 * m.taxShock
    - 4 * w.austerity
    - (d.status === 'default' ? 0.6 : 0);
  const target = 0.45 + 0.33 * Math.tanh(x);
  m.approval = clamp(0.75 * m.approval + 0.25 * target, 0.02, 0.98);
  m.lowStreak = m.approval < 0.25 || m.poverty > P.poverty0 + 0.1 ? m.lowStreak + 1 : 0;
  if (m.lowStreak >= 2 && w.outcome.estallido == null) {
    w.outcome.estallido = w.t;
    w.log('politica', m.approval < 0.25
      ? 'ESTALLIDO SOCIAL: la aprobación lleva meses por debajo de 25%.'
      : `ESTALLIDO SOCIAL: la pobreza llega a ${Math.round(m.poverty * 100)}%.`);
  }
  if (w.t % P.electionEvery === 0) {
    if (m.approval < 0.4) {
      if (w.outcome.lostElection == null) w.outcome.lostElection = w.t;
      w.log('politica', `Elecciones: tu coalición pierde con ${Math.round(m.approval * 100)}% de aprobación.`);
    } else {
      w.log('politica', `Elecciones: tu coalición gana con ${Math.round(m.approval * 100)}% de aprobación.`);
    }
  }
}

function record(w, fl, initial = false) {
  const m = w.macro, d = w.debt;
  const gdpN = fl.gdpN ?? fl.gdpReal * m.cpi;
  const gdpR = fl.gdpReal;
  const prev = w.hist[w.hist.length - 1];
  const row = {
    t: w.t,
    gdp: 4 * gdpR * w.calib.display,
    growth: m.growthYoY,
    u: m.uNat,
    informality: initial ? w.calib.informality0 : m.informality,
    poverty: initial ? P.poverty0 : m.poverty,
    inflation: m.inflA,
    fx: m.fx,
    debtGDP: Debt.totalDebt(w) / (4 * gdpN),
    spread: d.status === 'normal' ? d.spread : null,
    pDefault: d.pConsensus,
    rating: d.rating,
    status: d.status,
    revenue: initial ? fl.taxReal / gdpR : fl.revenue / gdpN,
    corp: fl.corp / gdpR, vat: fl.vat / gdpR, payroll: fl.payroll / gdpR, royalty: fl.royalty / gdpR, tariff: fl.tariff / gdpR, other: fl.other / gdpR,
    spending: initial ? null : fl.spending / gdpN,
    interest: initial ? null : fl.interest / gdpN,
    deficit: initial ? null : fl.deficit / gdpN,
    monet: initial ? 0 : fl.monet / gdpN,
    approval: m.approval,
    firms: w.firms.length,
    bySector: Object.fromEntries(SECTOR_KEYS.map((k) => [k, w.sectors[k].n])),
    entries: w.flow.entries, exits: w.flow.exits, relocations: w.flow.relocations,
    relocatedTotal: w.totals.relocations,
    lerner: Object.fromEntries(SECTOR_KEYS.map((k) => [k, w.sectors[k].lerner])),
    hhi: Object.fromEntries(SECTOR_KEYS.map((k) => [k, w.sectors[k].hhi])),
    barrier: Object.fromEntries(SECTOR_KEYS.map((k) => [k, w.sectors[k].entryBarrier])),
    importShare: Object.fromEntries(SECTOR_KEYS.map((k) => [k, w.sectors[k].importShare])),
    lenders: lenderSummary(w),
    commodity: m.commodity,
    rcap: sum(w.regions.map((r) => r.rcap * r.pop)),
    policyVol: m.policyVol,
    austerity: w.austerity,
  };
  if (prev && prev.rating !== row.rating && row.rating !== 'D') {
    const order = ['A-', 'BBB', 'BB+', 'BB-', 'B', 'CCC', 'CC', 'D'];
    const down = order.indexOf(row.rating) > order.indexOf(prev.rating);
    w.log('deuda', `Calificadoras ${down ? 'rebajan' : 'suben'} la nota soberana: ${prev.rating} → ${row.rating}.`);
  }
  w.hist.push(row);
}

function lenderSummary(w) {
  const out = {};
  for (const L of w.lenders) {
    const o = (out[L.type] ||= { share: 0, n: 0 });
    o.share += L.h;
    o.n += 1;
  }
  return out;
}

// ---------------------------------------------------------------- acciones del jugador

export function setPolicy(w, patch) {
  Object.assign(w.policy, patch);
}

export const actions = {
  defaultNow: (w) => Debt.declareDefault(w, 'el gobierno decide dejar de pagar.'),
  restructure: (w, haircut) => Debt.restructure(w, haircut),
  settleHoldouts: (w) => Debt.settleHoldouts(w),
};

export { Debt };
