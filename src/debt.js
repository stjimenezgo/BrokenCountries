// Mercado de deuda soberana con prestamistas heterogéneos (agentes).
// Cada prestamista estima su propia probabilidad de default, exige un retorno según su
// aversión al riesgo y su recuperación esperada, y tiene un tope por mandato.
// El spread es el mínimo que hace que la demanda total cubra el saldo de deuda.
import { LENDER_TYPES, RATINGS, P } from './config.js';

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function annualGDPnom(w) {
  return 4 * w.macro.gdpTrendReal * w.macro.cpi;
}

export function marketValue(w) {
  return w.debt.dom + w.debt.fx * w.macro.fx;
}

export function totalDebt(w) {
  const d = w.debt;
  return marketValue(w) + d.multi * w.macro.fx + d.holdouts;
}

export function initDebt(w) {
  const annual = annualGDPnom(w);
  const total = P.initialDebtGDP * annual;
  const multi = total * P.multiShare;
  const mkt = total - multi;
  w.debt = {
    dom: mkt * (1 - P.fxShare), fx: mkt * P.fxShare, multi,
    iDom: 0.075, iFx: 0.055, iMulti: 0.045,
    spread: 0.022, status: 'normal', defaultSince: null, offers: 0, lastOffer: null,
    holdouts: 0, holdoutSince: null, reputation: 0, pledged: false,
    rating: 'BB+', pConsensus: 0.013,
    vulture: { cost: 0, face: 0, paid: 0 },
  };
  w.lenders = [];
  for (const [type, n] of [['local', 6], ['global', 9], ['hedge', 2]]) {
    for (let i = 0; i < n; i++) addLender(w, type);
  }
  const H = w.lenders.map((L) => desiredHolding(w, L, 0.03, commonZ(w)));
  const tot = H.reduce((a, b) => a + b, 0) || 1;
  w.lenders.forEach((L, i) => { L.h = H[i] / tot; });
}

function addLender(w, type) {
  const T = LENDER_TYPES[type];
  const L = { id: w.nextLenderId++, type, W: T.W * Math.exp(0.3 * w.rng.normal()), bias: T.bias + 0.3 * w.rng.normal(), h: 0, hold: 0, idle: 0, since: w.t };
  w.lenders.push(L);
  return L;
}

// Componente común del riesgo percibido (logit de la probabilidad anual de default).
export function commonZ(w) {
  const m = w.macro, d = w.debt;
  const debtGDP = totalDebt(w) / annualGDPnom(w);
  return -4.3
    + 3.5 * (debtGDP - 0.6)
    + 12 * (m.deficitGDP - 0.04)
    + 6 * m.policyVol
    + 3 * Math.max(0, 0.4 - m.approval)
    - 0.8 * (m.commodity - 1)
    + 8 * Math.max(0, m.inflA - 0.06)
    + 10 * (m.rf - P.rf0)
    + d.reputation
    - (d.pledged ? 0.6 : 0);
}

export function ratingFromP(p) {
  for (const [th, r] of RATINGS) if (p < th) return r;
  return 'CC';
}

function recovery(w, L) {
  const T = LENDER_TYPES[L.type];
  let rec = T.rec + (w.debt.pledged ? 0.12 : 0);
  // Los locales y globales se impacientan durante el default (mandatos, liquidez).
  if (w.debt.status === 'default' && (L.type === 'local' || L.type === 'global')) {
    rec -= 0.015 * (w.t - w.debt.defaultSince);
  }
  return clamp(rec, 0.05, 0.95);
}

export function desiredHolding(w, L, s, z) {
  const T = LENDER_TYPES[L.type];
  const p = sigmoid(z + L.bias);
  const loss = 1 - recovery(w, L);
  const excess = (1 - p) * s - p * loss;
  if (excess <= 0) return 0;
  const mand = T.mandate ? (T.mandate[w.debt.rating] ?? 0) : 1;
  const share = Math.min(T.wmax * mand, excess / (T.gamma * loss * loss * p * (1 - p)));
  return share * L.W * annualGDPnom(w);
}

export function interestDue(w) {
  const d = w.debt, fx = w.macro.fx;
  let i = (d.iMulti / 4) * d.multi * fx;
  if (d.status !== 'default') i += (d.iDom / 4) * d.dom + (d.iFx / 4) * d.fx * fx;
  return i;
}

// Paso 1: ¿cuánto del financiamiento requerido consigue el gobierno y a qué spread?
export function quote(w, netNeed) {
  const d = w.debt;
  const z = commonZ(w);
  d.pConsensus = sigmoid(z);
  if (d.status === 'default') {
    d.rating = 'D';
    return { s: P.maxSpread, shortfall: Math.max(0, netNeed), z };
  }
  d.rating = ratingFromP(d.pConsensus);
  const MV = marketValue(w);
  const rollover = MV / P.maturityQ;
  const Nold = MV - rollover;
  if (d.status === 'holdouts') {
    // Bloqueo por litigio (pari passu): solo se refinancia lo que vence, sin plata nueva.
    return { s: Math.max(0.06, d.spread), shortfall: Math.max(0, netNeed), z, rollover, blocked: true };
  }
  const target = MV + netNeed;
  const demand = (s) => w.lenders.reduce((a, L) => a + desiredHolding(w, L, s, z), 0);
  const cap = demand(P.maxSpread);
  if (cap >= target) {
    let lo = 0, hi = P.maxSpread;
    for (let it = 0; it < 40; it++) {
      const mid = 0.5 * (lo + hi);
      if (demand(mid) >= target) hi = mid; else lo = mid;
    }
    return { s: hi, shortfall: 0, z, rollover };
  }
  return { s: P.maxSpread, shortfall: Math.max(0, target - Math.max(cap, Nold)), z, rollover };
}

// Paso 2: emitir la deuda y repartirla entre prestamistas.
export function issue(w, netNeed, q) {
  const d = w.debt, m = w.macro;
  if (d.status === 'default') return;
  const fx = m.fx;
  const mat = P.maturityQ;
  const F = q.rollover + (q.blocked ? Math.min(0, netNeed) : netNeed);
  const domOld = d.dom * (1 - 1 / mat), fxOld = d.fx * (1 - 1 / mat);
  const iNewDom = m.rf + q.s + Math.max(0, m.inflExpA - P.inflTargetA) + 0.01;
  const iNewFx = m.rf + q.s;
  if (F >= 0) {
    const domNew = F * (1 - P.fxShare), fxNew = (F * P.fxShare) / fx;
    d.iDom = (d.iDom * domOld + iNewDom * domNew) / Math.max(1e-9, domOld + domNew);
    d.iFx = (d.iFx * fxOld + iNewFx * fxNew) / Math.max(1e-9, fxOld + fxNew);
    d.dom = domOld + domNew;
    d.fx = fxOld + fxNew;
  } else {
    // Superávit mayor que los vencimientos: se recompra deuda.
    const k = Math.max(0, 1 + F / Math.max(1e-9, domOld + fxOld * fx));
    d.dom = domOld * k;
    d.fx = fxOld * k;
  }
  d.spread = q.s;
  const H = w.lenders.map((L) => desiredHolding(w, L, q.s, q.z));
  const tot = H.reduce((a, b) => a + b, 0);
  if (tot > 0) w.lenders.forEach((L, i) => { L.h = H[i] / tot; });
}

export function declareDefault(w, reason) {
  const d = w.debt, m = w.macro;
  if (d.status === 'default') return;
  d.status = 'default';
  d.defaultSince = w.t;
  d.offers = 0;
  d.lastOffer = null;
  d.rating = 'D';
  m.fxShockNext += 0.2;
  m.creditCrunch = 0.06;
  m.approval -= 0.06;
  if (w.outcome.default == null) w.outcome.default = w.t;
  w.log('crisis', `DEFAULT: ${reason}`);
}

// Dinámica de deuda en cesación de pagos: intereses de mora, venta a fondos buitre,
// ofertas de reestructuración y litigio de holdouts.
export function defaultDynamics(w) {
  const d = w.debt, m = w.macro;
  if (d.status === 'default') {
    d.dom *= 1 + d.iDom / 4;
    d.fx *= 1 + d.iFx / 4;
    // Los que tienen mandato venden bonos en default a precio de remate.
    const price = 0.3;
    const MV = marketValue(w);
    const sellers = w.lenders.filter((L) => L.type === 'local' || L.type === 'global');
    const buyers = w.lenders.filter((L) => L.type === 'buitre' || L.type === 'hedge');
    const forSale = sellers.reduce((a, L) => a + 0.3 * L.h, 0);
    const capShares = buyers.map((L) => (LENDER_TYPES[L.type].wmax * L.W * annualGDPnom(w)) / price / Math.max(1e-9, MV));
    const capTot = capShares.reduce((a, b) => a + b, 0);
    const sold = Math.min(forSale, capTot);
    if (sold > 0) {
      sellers.forEach((L) => { L.h -= (0.3 * L.h) * (sold / forSale); });
      buyers.forEach((L, i) => {
        const got = sold * (capShares[i] / capTot);
        L.h += got;
        if (L.type === 'buitre') { d.vulture.cost += got * MV * price; d.vulture.face += got * MV; }
      });
    }
    if (w.policy.autopilot) {
      const since = w.t - d.defaultSince;
      if (since >= 4 && (d.lastOffer == null || w.t - d.lastOffer >= 2)) {
        restructure(w, Math.max(0.15, 0.45 - 0.08 * d.offers));
      }
    }
  } else if (d.status === 'holdouts') {
    d.holdouts *= 1 + 0.09 / 4;
    if (w.policy.autopilot && w.t - d.holdoutSince >= 8) settleHoldouts(w);
  }
  d.reputation *= 0.95;
}

export function restructure(w, haircut) {
  const d = w.debt;
  if (d.status !== 'default') return null;
  d.offers += 1;
  d.lastOffer = w.t;
  const MV = marketValue(w);
  let accepted = 0;
  for (const L of w.lenders) {
    L.accepts = (1 - haircut) >= recovery(w, L);
    if (L.accepts) accepted += L.h;
  }
  const pct = Math.round(accepted * 100);
  if (accepted < 0.5) {
    w.log('crisis', `Oferta de reestructuración con quita de ${Math.round(haircut * 100)}% rechazada (solo ${pct}% acepta).`);
    return { ok: false, accepted };
  }
  const bindAll = w.policy.cac && accepted >= 0.75;
  const keep = bindAll ? 1 : accepted;
  const holdoutShare = 1 - keep;
  d.holdouts = MV * holdoutShare;
  d.holdouts0 = d.holdouts;
  d.dom *= keep * (1 - haircut);
  d.fx *= keep * (1 - haircut);
  d.iDom = w.macro.rf + 0.03 + 0.5 * Math.max(0, w.macro.inflExpA - P.inflTargetA);
  d.iFx = w.macro.rf + 0.03;
  for (const L of w.lenders) {
    const isIn = bindAll || L.accepts;
    if (L.type === 'buitre') {
      if (isIn) d.vulture.paid += L.h * MV * (1 - haircut);
      else L.hold = L.h * MV;
    }
    L.h = isIn ? L.h / keep : 0;
  }
  d.status = holdoutShare > 1e-6 ? 'holdouts' : 'normal';
  d.holdoutSince = d.status === 'holdouts' ? w.t : null;
  d.reputation = 1.2;
  d.spread = 0.06;
  w.macro.creditCrunch *= 0.5;
  w.log('crisis', bindAll
    ? `Reestructuración exitosa: quita de ${Math.round(haircut * 100)}%, ${pct}% aceptó y las cláusulas CAC obligan al resto.`
    : `Reestructuración parcial: quita de ${Math.round(haircut * 100)}%, ${pct}% aceptó. Holdouts litigan por ${Math.round(holdoutShare * 100)}% de la deuda y bloquean el acceso al mercado.`);
  return { ok: true, accepted, holdoutShare };
}

export function settleHoldouts(w) {
  const d = w.debt;
  if (d.status !== 'holdouts') return;
  const pay = d.holdouts;
  // Se paga emitiendo deuda nueva (como Argentina en 2016).
  d.dom += pay;
  const growth = pay / Math.max(1e-9, d.holdouts0);
  for (const L of w.lenders) {
    if (L.type === 'buitre' && L.hold > 0) d.vulture.paid += L.hold * growth;
    L.hold = 0;
  }
  d.holdouts = 0;
  d.status = 'normal';
  d.holdoutSince = null;
  const roi = d.vulture.cost > 0 ? d.vulture.paid / d.vulture.cost - 1 : 0;
  w.log('crisis', `Acuerdo con holdouts: se les paga el 100% más intereses. Retorno de los fondos buitre: ${Math.round(roi * 100)}%.`);
}

// Entrada y salida de prestamistas: spreads altos atraen capital con otro apetito de riesgo.
export function lenderDynamics(w) {
  const d = w.debt, rng = w.rng;
  const s = d.status === 'normal' ? d.spread : 0.15;
  const lam = 0.12 + Math.min(2.5, (Math.max(0, s - 0.03) / 0.02) * 0.5) + (d.status === 'default' ? 1.0 : 0);
  const n = rng.poisson(lam);
  const arrived = { hedge: 0, buitre: 0 };
  for (let i = 0; i < n; i++) {
    let weights;
    if (d.status !== 'normal' || s > 0.08) weights = [0, 0, 0.4, 0.6];
    else if (s > 0.04) weights = [0, 0.3, 0.6, 0.1];
    else weights = [0.3, 0.6, 0.1, 0];
    const type = ['local', 'global', 'hedge', 'buitre'][rng.pick(weights)];
    addLender(w, type).h = 0;
    if (type in arrived) arrived[type]++;
  }
  const spr = d.status === 'normal' ? `un spread de ${Math.round(s * 10000)} pb` : 'bonos en default a precio de remate';
  if (arrived.buitre) w.log('deuda', `${arrived.buitre === 1 ? 'Entra un fondo buitre' : `Entran ${arrived.buitre} fondos buitre`} atraído${arrived.buitre > 1 ? 's' : ''} por ${spr}.`);
  if (arrived.hedge && s > 0.05) w.log('deuda', `${arrived.hedge === 1 ? 'Entra un hedge fund' : `Entran ${arrived.hedge} hedge funds`}: "siempre aparece alguien que presta".`);
  w.lenders = w.lenders.filter((L) => {
    if (L.h < 1e-4 && L.hold <= 0) L.idle++; else L.idle = 0;
    if (L.type === 'local') return true;
    return L.idle < 8;
  });
  const tot = w.lenders.reduce((a, L) => a + L.h, 0);
  if (tot > 0) w.lenders.forEach((L) => { L.h /= tot; });
}
