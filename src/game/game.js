// Controlador del juego: une el motor (model.js) con la vista isométrica y las ventanas tipo SimCity.
import { createWorld, step, setPolicy, actions } from '../model.js';
import { DEFAULT_POLICY, LEVERS, TOGGLES, SECTORS, SECTOR_KEYS, LENDER_TYPES, P } from '../config.js';
import { STRATEGIES } from '../experiments.js';
import { IsoView } from './iso.js';
import { advise } from './advisors.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const pct = (x, d = 1) => (x == null || !isFinite(x) ? '–' : `${(x * 100).toFixed(d)}%`);
const num = (x, d = 0) => x.toLocaleString('es-CO', { maximumFractionDigits: d, minimumFractionDigits: d });
const lever = (k) => LEVERS.find((l) => l.key === k);
const fmtLever = (l, v) => (l.unit === 'pct' ? pct(v, 0) : l.unit === 'pib' ? pct(v, 2) : l.unit === 'x' ? `${v.toFixed(2)}×` : v.toFixed(2));

// Milisegundos por trimestre: lento para que alcance a leer las señales de los asesores.
const SPEED_MS = { 1: 7000, 2: 3500, 3: 1200 };
const G = { w: null, speed: 0, resume: 2, last: 0, overlay: null, selected: null, chart: null, picks: new Set(['u', 'poverty', 'debtGDP', 'approval']), seenEvents: 0, flows: {}, advice: [], adviceLevel: {}, saidAt: {}, pauseOnRed: true, refs: [], ideology: '', preset: 'statu_quo', shownElection: new Set() };

const iso = new IsoView($('#iso'));

// ------------------------------------------------------------ partida

function newGame({ seed = 1, preset = 'statu_quo', ideology = '' } = {}) {
  const S = STRATEGIES.find((s) => s.id === preset) ?? STRATEGIES[0];
  G.w = createWorld({ seed, policy: { ...DEFAULT_POLICY, ...S.policy, focus: {} } });
  G.base = { ...G.w.policy };
  G.ideology = ideology;
  G.preset = preset;
  G.seenEvents = G.w.events.length;
  G.flows = Object.fromEntries(SECTOR_KEYS.map((k) => [k, []]));
  G.shownElection.clear();
  iso.selected = G.selected = null;
  G.advice = advise(G.w);
  G.adviceLevel = Object.fromEntries(G.advice.map((a) => [a.id, a.level]));
  G.saidAt = {};
  iso.sync(G.w);
  iso.fit();
  refresh();
  setTicker([`Comienza tu gobierno con el paquete «${S.name}». Pulsa ▶ para que corra el tiempo.`]);
}

function tick() {
  const w = G.w;
  step(w);
  for (const k of SECTOR_KEYS) {
    const s = w.sectors[k];
    G.flows[k].push(s.entries - s.exits - s.relocs);
    if (G.flows[k].length > 6) G.flows[k].shift();
  }
  iso.sync(w);
  const fresh = w.events.slice(G.seenEvents);
  G.seenEvents = w.events.length;
  handleEvents(fresh);
  updateAdvice();
  refresh();
  checkElection();
}

function loop(now) {
  if (G.speed > 0 && now - G.last > SPEED_MS[G.speed]) { G.last = now; tick(); }
  iso.draw(now);
  requestAnimationFrame(loop);
}

function setSpeed(s) {
  G.speed = s;
  if (s > 0) G.resume = s;
  for (const b of $$('.g-speed button')) b.classList.toggle('on', +b.dataset.speed === s);
}

// ------------------------------------------------------------ HUD

function refresh() {
  const w = G.w, h = w.hist.at(-1);
  $('#g-date').textContent = `Año ${Math.floor(w.t / 4) + 1} · T${(w.t % 4) + 1}`;
  const nextElection = P.electionEvery - (w.t % P.electionEvery);
  const stat = (k, v, cls = '') => `<div class="stat ${cls}"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  $('#g-stats').innerHTML = [
    stat('PIB', `${num(h.gdp)} bill.`),
    stat('Crecimiento', pct(h.growth), h.growth < 0 ? 'bad' : h.growth > 0.03 ? 'good' : ''),
    stat('Desempleo', pct(h.u), h.u > 0.13 ? 'bad' : ''),
    stat('Inflación', pct(h.inflation), h.inflation > 0.08 ? 'bad' : ''),
    stat('Pobreza', pct(h.poverty, 0), h.poverty > 0.38 ? 'bad' : ''),
    stat('Deuda/PIB', pct(h.debtGDP, 0), h.debtGDP > 0.7 ? 'bad' : ''),
    stat('Calificación', h.rating, ['CCC', 'CC', 'D'].includes(h.rating) ? 'bad' : ['B', 'BB-'].includes(h.rating) ? 'warn' : 'good'),
    stat('Aprobación', pct(h.approval, 0), h.approval < 0.4 ? 'bad' : 'good'),
    stat('Elecciones en', `${nextElection} trim.`, nextElection <= 2 ? 'warn' : ''),
  ].join('');
  renderDemand();
  renderAlerts();
  renderRegion();
  paintOverlay();
  if (!$('#win-debt').hidden) renderDebt();
  if (!$('#win-charts').hidden) renderChart();
  if (!$('#win-laws').hidden) renderLaws();
  if (!$('#win-advisors').hidden) renderAdvisors();
  renderAdviceBadge();
}

function renderDemand() {
  $('#g-demand').innerHTML = SECTOR_KEYS.map((k) => {
    const S = SECTORS[k], n = Math.max(3, G.w.sectors[k].n * 0.12);
    const v = Math.max(-1, Math.min(1, G.flows[k].reduce((a, b) => a + b, 0) / n));
    const style = v >= 0 ? `left:50%;width:${v * 50}%;background:${S.color}` : `right:50%;width:${-v * 50}%;background:#e5533d`;
    return `<div class="dem-row" title="Empresas que entran menos las que quiebran o se van (últimos 6 trimestres)"><span>${S.name.split(' ')[0]}</span><div class="dem-bar"><i style="${style}"></i></div></div>`;
  }).join('');
}

function renderAlerts() {
  const w = G.w, d = w.debt, out = [];
  if (w.macro.strike > 0) out.push(['bad', `🚩 <b>${cap(w.macro.strikeKind)}</b>: producir cuesta ${Math.round(w.macro.strike * 100)}% más mientras dure.`, '<button data-act="negotiate">Negociar</button>']);
  if (d.status === 'default') out.push(['bad', '💥 <b>El país está en default.</b> Nadie te presta; el banco central imprime para pagar.', '<button data-act="open-debt">Ver deuda</button>']);
  if (d.status === 'holdouts') out.push(['', '⚖️ <b>Holdouts litigando</b>: bloquean tu regreso a los mercados.', '<button data-act="open-debt">Ver deuda</button>']);
  if (w.austerity > 0.02) out.push(['', `✂️ Recorte de emergencia del ${Math.round(w.austerity * 100)}% del gasto: no alcanzó el financiamiento.`, '']);
  $('#g-alerts').innerHTML = out.map(([c, t, b]) => `<div class="alert ${c}"><span class="txt">${t}</span>${b}</div>`).join('');
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

// ------------------------------------------------------------ capas del mapa

const LAYERS = [
  { key: null, label: 'Ninguna' },
  { key: 'u', label: 'Desempleo', f: (r) => (r.u - 0.05) / 0.15, lo: '5%', hi: '20%' },
  { key: 'informality', label: 'Informalidad', f: (r) => (r.informality - 0.35) / 0.4, lo: '35%', hi: '75%' },
  { key: 'crime', label: 'Crimen', f: (r) => (r.crime - 0.3) / 0.9, lo: 'bajo', hi: 'alto' },
  { key: 'health', label: 'Salud', f: (r) => 1 - (r.health - 0.4) / 0.7, lo: 'buena', hi: 'débil' },
  { key: 'sec', label: 'Seguridad', f: (r) => 1 - (r.sec - 0.3) / 0.7, lo: 'alta', hi: 'baja' },
  { key: 'infra', label: 'Infraestructura', f: (r) => 1 - (r.infra - 0.3) / 0.8, lo: 'buena', hi: 'mala' },
  { key: 'd', label: 'Demanda', f: (r) => 1 - (r.d - 0.8) / 0.4, lo: 'fuerte', hi: 'débil' },
  { key: 'rcap', label: 'Costo del capital', f: (r) => (r.rcap - 0.05) / 0.12, lo: '5%', hi: '17%' },
];

function buildLayers() {
  $('#g-layers').innerHTML = LAYERS.map((l, i) => `<button data-layer="${i}" class="${i === 0 ? 'on' : ''}">${l.label}</button>`).join('');
  $('#g-layers').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    G.overlay = LAYERS[+b.dataset.layer].key ? LAYERS[+b.dataset.layer] : null;
    for (const x of $$('#g-layers button')) x.classList.toggle('on', x === b);
    paintOverlay();
  });
}

function paintOverlay() {
  const L = G.overlay;
  if (!L) { iso.overlay = null; $('#g-legend').innerHTML = ''; return; }
  iso.overlay = { values: Object.fromEntries(G.w.regions.map((r) => [r.id, L.f(r)])) };
  $('#g-legend').innerHTML = `<div class="grad"></div><div class="ends"><span>${L.lo}</span><span>${L.hi}</span></div>`;
}

// ------------------------------------------------------------ región seleccionada

function renderRegion() {
  const box = $('#g-region');
  if (document.activeElement?.id === 'focus') return; // no se redibuja mientras se arrastra
  const r = G.w.regions.find((x) => x.id === G.selected);
  if (!r) {
    if (G.selected === 'vecino') return renderNeighbor(box);
    box.hidden = true; return;
  }
  box.hidden = false;
  const bySector = Object.fromEntries(SECTOR_KEYS.map((k) => [k, 0]));
  for (const f of G.w.firms) if (f.region === r.idx) bySector[f.sector]++;
  const lfTot = G.w.regions.reduce((a, x) => a + x.lf, 0);
  const focus = G.w.policy.focus?.[r.id] ?? 1;
  const meter = (v, good = true) => `<div class="meter"><i style="width:${Math.max(3, Math.min(100, v * 100))}%;background:${good ? 'var(--ok)' : 'var(--bad)'}"></i></div>`;
  box.innerHTML = `
    <h2>${r.name}</h2>
    <div class="sub">${pct(r.lf / lfTot, 0)} de la fuerza laboral · ${r.firms} empresas</div>
    <div class="kv">
      <span class="k">Desempleo</span><b>${pct(r.u)}</b>
      <span class="k">Informalidad</span><b>${pct(r.informality, 0)}</b>
      <span class="k">Crimen (base = 100)</span><b>${Math.round((r.crime / r.crimeBase) * 100)}</b>
      <span class="k">Costo del capital</span><b>${pct(r.rcap)}</b>
      <span class="k">Demanda local</span><b>${Math.round(r.d * 100)}</b>
      ${r.sick > 0.01 ? '<span class="k">Epidemia</span><b style="color:var(--bad)">activa</b>' : ''}
    </div>
    <div class="sect">Bienes públicos (Bogotá = 1)</div>
    <div class="kv"><span class="k">Infraestructura</span><b>${r.infra.toFixed(2)}</b></div>${meter(r.infra / 1.3)}
    <div class="kv"><span class="k">Capital humano</span><b>${r.hc.toFixed(2)}</b></div>${meter(r.hc / 1.3)}
    <div class="kv"><span class="k">Seguridad</span><b>${r.sec.toFixed(2)}</b></div>${meter(r.sec / 1.2)}
    <div class="kv"><span class="k">Salud</span><b>${r.health.toFixed(2)}</b></div>${meter(r.health / 1.3)}
    <div class="kv"><span class="k">Bomberos</span><b>${r.fire.toFixed(2)}</b></div>${meter(r.fire / 1.6)}
    <div class="sect">Empresas por sector</div>
    <div class="chips">${SECTOR_KEYS.map((k) => `<span><i style="background:${SECTORS[k].color}"></i>${SECTORS[k].name.split(' ')[0]} ${bySector[k]}</span>`).join('')}</div>
    <div class="sect">Prioridad de inversión</div>
    <div class="law"><div class="lab"><span>Infraestructura, policía, salud y bomberos</span><b id="focus-v">${focus.toFixed(2)}×</b></div>
      <input type="range" id="focus" min="0.25" max="3" step="0.25" value="${focus}">
      <div class="hint">El total del gasto no cambia: lo que pongas aquí se lo quitas a las demás regiones.</div></div>
    <div class="row-end"><button data-act="deselect">Cerrar</button></div>`;
  $('#focus').addEventListener('input', (e) => {
    const v = +e.target.value;
    G.w.policy.focus = { ...G.w.policy.focus, [r.id]: v };
    $('#focus-v').textContent = `${v.toFixed(2)}×`;
  });
}

function renderNeighbor(box) {
  box.hidden = false;
  const by = {};
  for (const f of G.w.relocated) by[f.sector] = (by[f.sector] || 0) + 1;
  box.innerHTML = `
    <h2>País vecino estable</h2>
    <div class="sub">No lo gobiernas. Compite contigo por las empresas.</div>
    <div class="kv">
      <span class="k">Renta de empresas</span><b>25% (no cambia)</b>
      <span class="k">Prima de riesgo</span><b>+2 pp sobre la tasa mundial</b>
      <span class="k">Costo laboral / salario</span><b>1,30 (aquí 1,44)</b>
      <span class="k">Empresas que se mudaron</span><b>${G.w.relocated.length}</b>
    </div>
    <div class="sect">Por sector</div>
    <div class="chips">${Object.entries(by).map(([k, n]) => `<span><i style="background:${SECTORS[k].color}"></i>${SECTORS[k].name.split(' ')[0]} ${n}</span>`).join('') || '<span>Ninguna todavía</span>'}</div>
    <p class="hint" style="margin-top:10px">Desde allá siguen vendiéndote, pero pagan impuestos y empleo afuera. Se van cuando el valor de producir allá (menos lo que pierden al mudarse) supera al de quedarse.</p>
    <div class="row-end"><button data-act="deselect">Cerrar</button></div>`;
}

// ------------------------------------------------------------ presupuesto

const TAX_ROWS = [['corpTax', 'corp', 'Renta de empresas'], ['vat', 'vat', 'IVA'], ['payrollTax', 'payroll', 'Parafiscales a la nómina'], ['royalty', 'royalty', 'Regalías mineras'], ['tariff', 'tariff', 'Aranceles']];
const SPEND_ROWS = [['security', '🚓 Policía y justicia'], ['fire', '🚒 Bomberos'], ['health', '🏥 Salud'], ['education', '🎓 Educación'], ['infra', '🛣️ Infraestructura y transporte'], ['transfers', '🤝 Subsidios y transferencias'], ['enforcement', '🔎 Fiscalización (DIAN)'], ['competition', '⚖️ Autoridad de competencia']];

function control(k) {
  const l = lever(k), v = G.w.policy[k];
  return `<div class="ctl-wrap" data-k="${k}"><button data-d="-1">−</button><input type="range" min="${l.min}" max="${l.max}" step="${l.step}" value="${v}"><button data-d="1">+</button><span class="v ${Math.abs(v - G.base[k]) > 1e-9 ? 'changed' : ''}">${fmtLever(l, v)}</span></div>`;
}

function renderBudget() {
  const w = G.w, h = w.hist.at(-1), gdp = h.gdp, ex = w.exec;
  const bill = (s) => num(s * gdp);
  let rows = '<tr class="sec"><td colspan="4">Ingresos</td></tr>';
  let revTot = 0;
  for (const [k, hk, label] of TAX_ROWS) {
    revTot += h[hk];
    rows += `<tr title="${lever(k).help}"><td>${label}</td><td class="ctl">${control(k)}</td><td>${pct(h[hk], 1)}</td><td>${bill(h[hk])}</td></tr>`;
  }
  revTot += h.other;
  rows += `<tr><td>Otros (predial, GMF, timbre…)</td><td class="ctl hint">depende de la formalidad</td><td>${pct(h.other, 1)}</td><td>${bill(h.other)}</td></tr>`;
  rows += `<tr class="tot"><td>Total ingresos</td><td></td><td>${pct(revTot, 1)}</td><td>${bill(revTot)}</td></tr>`;
  rows += '<tr class="sec"><td colspan="4">Gastos</td></tr>';
  const aust = 1 - w.austerity;
  let spTot = 0;
  for (const [k, label] of SPEND_ROWS) {
    const s = w.policy[k] * (k === 'enforcement' || k === 'competition' ? 1 : aust);
    spTot += s;
    rows += `<tr title="${lever(k).help}"><td>${label}</td><td class="ctl">${control(k)}</td><td>${pct(s, 2)}</td><td>${bill(s)}</td></tr>`;
  }
  spTot += P.inflexibleSpending;
  rows += `<tr><td>🧾 Pensiones y gasto inflexible</td><td class="ctl hint">no se puede mover</td><td>${pct(P.inflexibleSpending, 1)}</td><td>${bill(P.inflexibleSpending)}</td></tr>`;
  const interest = h.interest ?? 0.035;
  spTot += interest;
  rows += `<tr><td>💸 Intereses de la deuda</td><td class="ctl hint">los pone el mercado (spread)</td><td>${pct(interest, 1)}</td><td>${bill(interest)}</td></tr>`;
  rows += `<tr class="tot"><td>Total gastos</td><td></td><td>${pct(spTot, 1)}</td><td>${bill(spTot)}</td></tr>`;
  const bal = revTot - spTot + w.policy.monetization;
  rows += `<tr class="tot"><td>${bal >= 0 ? 'Superávit' : 'Déficit'} proyectado</td><td class="ctl hint">${w.policy.monetization > 0 ? `incluye ${pct(w.policy.monetization, 1)} de emisión` : 'lo que falte se pide prestado'}</td><td class="${bal < 0 ? 'neg' : 'pos'}">${pct(bal, 1)}</td><td class="${bal < 0 ? 'neg' : 'pos'}">${bill(bal)}</td></tr>`;
  $('#budget-body').innerHTML = `
    <table class="bud"><thead><tr><th>Partida</th><th>Tasa o asignación</th><th>% del PIB</th><th>Billones/año</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="hint" style="margin-top:8px">Los ingresos que ves son los del último trimestre: <b>si subes un impuesto, el recaudo cambia cuando las empresas reaccionen</b> (se informalizan, producen menos o se van). Por eso no basta con subir todas las tasas. Los gastos sí cambian de inmediato.</p>
    ${w.austerity > 0.02 ? `<p class="hint" style="color:var(--bad)">Recorte de emergencia vigente: ${Math.round(w.austerity * 100)}% del gasto discrecional.</p>` : ''}
    <div class="row-end"><button data-act="reset-budget">Volver al presupuesto inicial</button><button class="primary" data-close>Listo</button></div>`;
}

function bindControls(root, rerender) {
  // Mientras se arrastra solo cambia la cifra; al soltar se recalcula la tabla.
  root.addEventListener('input', (e) => {
    const wrap = e.target.closest('.ctl-wrap');
    if (!wrap || e.target.type !== 'range') return;
    setPolicy(G.w, { [wrap.dataset.k]: +e.target.value });
    wrap.querySelector('.v').textContent = fmtLever(lever(wrap.dataset.k), +e.target.value);
  });
  root.addEventListener('change', (e) => { if (e.target.closest('.ctl-wrap')) rerender(); });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-d]');
    if (!b) return;
    const k = b.closest('.ctl-wrap').dataset.k, l = lever(k);
    const v = Math.min(l.max, Math.max(l.min, +(G.w.policy[k] + +b.dataset.d * l.step).toFixed(5)));
    setPolicy(G.w, { [k]: v });
    rerender();
  });
}

// ------------------------------------------------------------ leyes

function renderLaws() {
  const w = G.w;
  const law = (k) => {
    const l = lever(k), v = w.policy[k];
    return `<div class="law" data-k="${k}"><div class="lab"><span>${l.label}</span><b>${fmtLever(l, v)}</b></div>
      <input type="range" min="${l.min}" max="${l.max}" step="${l.step}" value="${v}"><div class="hint">${l.help}</div></div>`;
  };
  $('#laws-body').innerHTML = `
    ${law('minWage')}${law('regulation')}${law('monetization')}
    <div class="sect hint" style="margin:6px 0">Decretos sobre la deuda</div>
    ${TOGGLES.map((t) => `<label class="tog"><input type="checkbox" data-tog="${t.key}" ${w.policy[t.key] ? 'checked' : ''}><span>${t.label}<small>${t.help}</small></span></label>`).join('')}`;
}

// ------------------------------------------------------------ deuda

function renderDebt() {
  const w = G.w, d = w.debt, h = w.hist.at(-1);
  const lend = h.lenders;
  const tot = Object.values(lend).reduce((a, x) => a + x.share, 0) || 1;
  const bar = Object.entries(LENDER_TYPES).map(([k, T]) => `<i style="width:${((lend[k]?.share ?? 0) / tot) * 100}%;background:${T.color}" title="${T.name}"></i>`).join('');
  const legend = Object.entries(LENDER_TYPES).map(([k, T]) => `<span><i style="background:${T.color}"></i>${T.name}: ${pct((lend[k]?.share ?? 0) / tot, 0)} (${lend[k]?.n ?? 0})</span>`).join('');
  const status = { normal: 'Pagando normalmente', default: `En default desde T${d.defaultSince}`, holdouts: 'Reestructurada, con holdouts litigando' }[d.status];
  const hc = +($('#haircut')?.value ?? 0.4);
  $('#debt-body').innerHTML = `
    <div class="cards">
      <div class="card"><div class="k">Deuda / PIB</div><div class="v">${pct(h.debtGDP, 0)}</div></div>
      <div class="card"><div class="k">Spread</div><div class="v">${h.spread == null ? '–' : `${Math.round(h.spread * 10000)} pb`}</div></div>
      <div class="card"><div class="k">Calificación</div><div class="v">${h.rating}</div></div>
      <div class="card"><div class="k">Prob. de default (mercado)</div><div class="v">${pct(h.pDefault, 1)}</div></div>
    </div>
    <p><b>Estado:</b> ${status}${d.pledged ? ' · regalías pignoradas' : ''}</p>
    ${h.cushion == null ? '' : `<p><b>Colchón del mercado:</b> compraría ${pct(h.cushion, 0)} de lo que hay que refinanciar; con una nota menos, ${pct(h.cushionDown, 0)}. Por debajo de 100% se cierra la puerta.</p>`}
    <p><b>Puente del multilateral:</b> ${d.bridge > 0 ? `usado ${pct(d.bridge / (4 * w.macro.gdpTrendReal * w.macro.cpi), 1)} del PIB de ${pct(P.bridge.max, 0)}; ` : ''}${Math.max(0, Math.floor(P.bridge.quarters - d.bridgeQ))} de ${P.bridge.quarters} trimestres disponibles si se cierran los mercados.</p>
    <p class="hint">¿Quién tiene tus bonos? Cuando los conservadores se llenan o te bajan la nota, el spread sube y aparecen prestamistas con más apetito de riesgo… y después los fondos buitre.</p>
    <div class="lend-bar">${bar}</div>
    <div class="chips" style="margin-bottom:12px">${legend}</div>
    <div class="crisis">
      <button class="danger" data-act="default" ${d.status !== 'normal' ? 'disabled' : ''}>Declarar default (dejar de pagar)</button>
      <label class="fld" style="margin:0">Quita ofrecida a los acreedores: <b id="haircut-v">${Math.round(hc * 100)}%</b>
        <input type="range" id="haircut" min="0.1" max="0.8" step="0.05" value="${hc}"></label>
      <button data-act="restructure" ${d.status !== 'default' ? 'disabled' : ''}>Ofrecer reestructuración</button>
      <button data-act="settle" ${d.status !== 'holdouts' ? 'disabled' : ''}>Pagarle a los holdouts</button>
    </div>`;
}

// ------------------------------------------------------------ asesores

const LEVEL = ['ok', 'warn', 'bad'];

// Un asesor habla cuando su señal empeora; si llega a alarma roja, el juego se pausa (como los desastres de SimCity).
function updateAdvice() {
  G.advice = advise(G.w);
  let red = false;
  for (const a of G.advice) {
    const prev = G.adviceLevel[a.id] ?? 0;
    // Sin repetir: vuelve a hablar si la señal empeora más que la última vez o si pasaron dos años.
    const said = G.saidAt[a.id];
    if (a.level > prev && (!said || a.level > said.level || G.w.t - said.t >= 8)) {
      speak(a);
      G.saidAt[a.id] = { t: G.w.t, level: a.level };
      if (a.level === 2) red = true;
    }
    G.adviceLevel[a.id] = a.level;
  }
  if (red && G.pauseOnRed && G.speed > 0) {
    setSpeed(0);
    setTicker(['⏸ Pausa: un asesor da alarma roja. Revisa sus gráficas, ajusta y pulsa ▶.']);
  }
}

function speak(a) {
  const el = document.createElement('div');
  el.className = `toast advice ${LEVEL[a.level]}`;
  el.innerHTML = `<div class="who">${a.icon} <b>${a.name}</b></div><div class="say"></div><div class="acts"><button data-chart="${a.id}">📈 Ver en gráfica</button><button data-dismiss>✕</button></div>`;
  el.querySelector('.say').textContent = a.say;
  $('#g-toasts').appendChild(el);
  if (a.level < 2) setTimeout(() => el.remove(), 14000);
  while ($('#g-toasts').children.length > 4) $('#g-toasts').firstChild.remove();
}

function renderAdviceBadge() {
  const worst = Math.max(0, ...G.advice.map((a) => a.level));
  const n = G.advice.filter((a) => a.level > 0).length;
  const b = $('#adv-badge');
  b.hidden = !n;
  b.textContent = n;
  b.className = `badge ${LEVEL[worst]}`;
}

function renderAdvisors() {
  const order = [...G.advice].sort((a, b) => b.level - a.level);
  $('#advisors-body').innerHTML = `
    <p class="hint">Cada asesor mira una señal temprana del modelo. Amarillo es atención; rojo, alarma. «Ver en gráfica» abre las series que lo muestran, con la línea de alerta punteada.</p>
    <div class="advisors">${order.map((a) => `
      <div class="adv ${LEVEL[a.level]}">
        <div class="adv-head"><span class="ic">${a.icon}</span><b>${a.name}</b><i class="dot"></i></div>
        <p></p>
        <button data-chart="${a.id}">📈 Ver en gráfica</button>
      </div>`).join('')}</div>
    <label class="tog"><input type="checkbox" id="pause-red" ${G.pauseOnRed ? 'checked' : ''}><span>Pausar el juego cuando un asesor da alarma roja</span></label>`;
  $$('#advisors-body .adv p').forEach((p, i) => { p.textContent = order[i].say; });
}

function showAdvice(id) {
  const a = G.advice.find((x) => x.id === id);
  if (!a) return;
  G.picks = new Set(a.series);
  G.refs = a.refs;
  for (const c of $$('#chart-picks input')) c.checked = G.picks.has(c.dataset.s);
  $('#chart-note').innerHTML = '';
  $('#chart-note').append(Object.assign(document.createElement('b'), { textContent: `${a.icon} ${a.name}: ` }), a.say);
  $('#chart-note').hidden = false;
  openWin('charts');
}

// ------------------------------------------------------------ gráficas

const SERIES = [
  ['gdp', 'PIB (billones)', '#f5b83d', 'y1'], ['growth', 'Crecimiento', '#9ccc65'], ['u', 'Desempleo', '#ef5350'],
  ['informality', 'Informalidad', '#a1887f'], ['poverty', 'Pobreza', '#ab47bc'], ['inflation', 'Inflación', '#ff9800'],
  ['debtGDP', 'Deuda/PIB', '#42a5f5'], ['spread', 'Spread', '#26c6da'], ['approval', 'Aprobación', '#66bb6a'],
  ['crime', 'Crimen (base = 100%)', '#e53935'], ['revenue', 'Recaudo/PIB', '#8d6e63'], ['deficit', 'Déficit/PIB', '#ec407a'],
  ['cushion', 'Colchón del mercado', '#00e5ff'], ['cushionDown', 'Colchón con una nota menos', '#80deea'], ['pDefault', 'Prob. de default', '#ff5252'],
  ['grievance', 'Malestar social', '#f06292'], ['monet', 'Emisión/PIB (trim.)', '#ffcc80'], ['sick', 'Población enferma', '#b39ddb'],
  ['firms', 'Empresas activas', '#90a4ae', 'y1'], ['relocatedTotal', 'Empresas que se fueron (acum.)', '#ff7043', 'y1'],
];

function buildChartPicks() {
  $('#chart-picks').innerHTML = SERIES.map(([k, label, c]) => `<label><input type="checkbox" data-s="${k}" ${G.picks.has(k) ? 'checked' : ''}> <span style="color:${c}">■</span> ${label}</label>`).join('');
  $('#chart-picks').addEventListener('change', (e) => {
    const k = e.target.dataset.s;
    if (e.target.checked) G.picks.add(k); else G.picks.delete(k);
    G.refs = [];
    $('#chart-note').hidden = true;
    renderChart();
  });
}

function renderChart() {
  if (!window.Chart) return;
  const h = G.w.hist;
  const datasets = SERIES.filter(([k]) => G.picks.has(k)).map(([k, label, c, axis]) => ({
    label, borderColor: c, backgroundColor: c, pointRadius: 0, borderWidth: 2, yAxisID: axis ?? 'y',
    data: h.map((r) => (r[k] == null ? null : axis ? r[k] : r[k] * 100)),
  }));
  const labels = h.map((r) => `A${Math.floor(r.t / 4) + 1}T${(r.t % 4) + 1}`);
  for (const ref of G.refs) {
    datasets.push({ label: ref.label, data: h.map(() => ref.v), borderColor: '#cfd8dc', borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, yAxisID: 'y' });
  }
  if (!G.chart) {
    Chart.defaults.color = '#a4afba';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.08)';
    G.chart = new Chart($('#g-chart'), {
      type: 'line', data: { labels, datasets },
      options: { animation: false, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: { y: { title: { display: true, text: '%' } }, y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'billones' } } },
        plugins: { legend: { display: false } } },
    });
  }
  G.chart.data.labels = labels;
  G.chart.data.datasets = datasets;
  const right = SERIES.filter(([k, , , axis]) => axis && G.picks.has(k)).map(([, label]) => label);
  G.chart.options.scales.y1.display = right.length > 0;
  G.chart.options.scales.y1.title.text = right.join(' · ');
  G.chart.options.plugins.legend.display = G.refs.length > 0;
  G.chart.update();
}

// ------------------------------------------------------------ periódico, eventos y elecciones

const PRIORITY = { crisis: 0, politica: 1, social: 2, deuda: 3, externo: 4, fiscal: 5, empresas: 6 };

function renderNews() {
  const w = G.w, h = w.hist.at(-1);
  const recent = w.events.filter((e) => w.t - e.t < 4).sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || b.t - a.t);
  const lead = recent[0]?.text ?? (h.growth > 0.03 ? `La economía crece ${pct(h.growth)} y el gobierno celebra` : 'Semana tranquila en la economía nacional');
  const rest = recent.slice(1, 7);
  const ops = [];
  if (w.policy.corpTax > NEIGHBOR_TAX + 0.15) ops.push(`Los gremios advierten: «con una renta de ${pct(w.policy.corpTax, 0)} contra 25% en el vecino, las empresas se van a ir».`);
  if (h.crime > 1.15) ops.push('Columnistas piden más policía; economistas recuerdan que el desempleo también empuja el crimen.');
  if ((h.deficit ?? 0) > 0.05) ops.push(`Analistas: «un déficit de ${pct(h.deficit, 1)} del PIB no se financia para siempre; los mercados ya lo notan».`);
  if (h.informality > 0.58) ops.push(`Casi ${pct(h.informality, 0)} de los trabajadores son informales: no pagan parafiscales ni IVA, y tampoco tienen pensión.`);
  if (h.approval < 0.35) ops.push('Encuesta: la mayoría desaprueba al gobierno. La oposición ya habla de las próximas elecciones.');
  if (w.policy.monetization > 0) ops.push('El banco central financia al gobierno. Los ahorradores compran dólares.');
  if (!ops.length) ops.push('Editorial: gobernar es elegir qué problema dejar para después.');
  $('#news-body').innerHTML = `
    <div class="masthead"><div class="name">La Gaceta del País</div><div class="meta">Año ${Math.floor(w.t / 4) + 1}, trimestre ${(w.t % 4) + 1} · Edición nacional</div></div>
    <div class="lead">${lead}</div>
    <div class="cols">${rest.map((e) => `<p><b>${e.text.split(':')[0]}</b>${e.text.includes(':') ? e.text.slice(e.text.indexOf(':') + 1) : ''}</p>`).join('') || '<p>Sin más noticias esta semana.</p>'}</div>
    <div class="op">${ops.slice(0, 3).join(' ')}</div>`;
}
const NEIGHBOR_TAX = 0.25;

function handleEvents(list) {
  if (!list.length) return;
  const sorted = [...list].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
  for (const e of sorted.slice(0, 3)) toast(e);
  setTicker(G.w.events.slice(-8).reverse().map((e) => e.text));
}

function toast(e) {
  const el = document.createElement('div');
  el.className = `toast ${e.kind}`;
  el.textContent = e.text;
  $('#g-toasts').appendChild(el);
  setTimeout(() => el.remove(), 6000);
  while ($('#g-toasts').children.length > 4) $('#g-toasts').firstChild.remove();
}

function setTicker(items) {
  const span = document.createElement('span');
  span.textContent = items.join('   •   ');
  span.style.animationDuration = `${Math.max(25, span.textContent.length / 9)}s`;
  $('#g-ticker').replaceChildren(span);
}

function checkElection() {
  const w = G.w;
  if (w.t % P.electionEvery !== 0 || G.shownElection.has(w.t)) return;
  G.shownElection.add(w.t);
  const h = w.hist.at(-1), h0 = w.hist[0];
  const won = h.approval >= 0.4;
  const term = w.t / P.electionEvery;
  const final = won && term >= 2;
  setSpeed(0);
  $('#end-title').textContent = won ? (final ? 'Terminaste dos mandatos' : '¡Reelegido!') : 'Perdiste las elecciones';
  const row = (k, a, b) => `<span class="k">${k}</span><b>${a} → ${b}</b>`;
  $('#end-body').innerHTML = `
    <p>${won ? `Tu coalición gana con ${pct(h.approval, 0)} de aprobación.` : `Tu coalición saca ${pct(h.approval, 0)}: necesitabas 40%.`}
    ${w.outcome.default != null ? ' El país entró en default durante tu gobierno.' : ' El país nunca dejó de pagar.'}</p>
    <div class="kv" style="margin-bottom:12px">
      ${row('PIB (billones)', num(h0.gdp), num(h.gdp))}
      ${row('Desempleo', pct(h0.u), pct(h.u))}
      ${row('Informalidad', pct(h0.informality, 0), pct(h.informality, 0))}
      ${row('Pobreza', pct(h0.poverty, 0), pct(h.poverty, 0))}
      ${row('Deuda/PIB', pct(h0.debtGDP, 0), pct(h.debtGDP, 0))}
      ${row('Calificación', h0.rating, h.rating)}
      <span class="k">Empresas que se fueron al vecino</span><b>${w.totals.relocations}</b>
      <span class="k">Incendios · huelgas</span><b>${w.totals.fires} · ${w.hist.filter((x, i) => x.strike > 0 && !(w.hist[i - 1]?.strike > 0)).length}</b>
    </div>
    <p class="hint">Exporta la partida para sumar tu resultado al experimento: ¿qué tan seguido quiebra el país según lo que cada quien cree?</p>
    <div class="row-end"><button data-act="export">Exportar partida (JSON)</button>${final ? '' : `<button ${won ? 'class="primary"' : ''} data-act="continue">${won ? 'Seguir gobernando' : 'Seguir de todas formas'}</button>`}<button ${won ? '' : 'class="primary"'} data-act="new">Nueva partida</button></div>`;
  openWin('end');
}

function exportGame() {
  const w = G.w;
  const data = {
    version: 1, source: 'juego', ideology: G.ideology || null, preset: G.preset, seed: w.seed, quarters: w.t,
    outcome: w.outcome, finalPolicy: w.policy, policyPath: w.policyHist,
    history: w.hist.map(({ t, gdp, growth, u, informality, poverty, inflation, debtGDP, spread, rating, status, deficit, approval, relocatedTotal, crime, strike }) =>
      ({ t, gdp, growth, u, informality, poverty, inflation, debtGDP, spread, rating, status, deficit, approval, relocatedTotal, crime, strike })),
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `broken-countries-juego-semilla${w.seed}-t${w.t}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ------------------------------------------------------------ ventanas

function openWin(name) {
  for (const x of $$('.win')) if (x.id !== `win-${name}`) x.hidden = true;
  const win = $(`#win-${name}`);
  if (name === 'budget') { if (G.speed > 0) { G.pausedForBudget = G.speed; setSpeed(0); } renderBudget(); }
  if (name === 'laws') renderLaws();
  if (name === 'debt') renderDebt();
  if (name === 'news') renderNews();
  if (name === 'advisors') renderAdvisors();
  win.hidden = false;
  if (name === 'charts') renderChart();
  for (const b of $$('.g-tools button')) b.classList.toggle('on', b.dataset.win === name);
}

function closeWins() {
  for (const x of $$('.win')) x.hidden = true;
  for (const b of $$('.g-tools button')) b.classList.remove('on');
  if (G.pausedForBudget) { setSpeed(G.pausedForBudget); G.pausedForBudget = 0; }
}

function act(name) {
  const w = G.w;
  if (name === 'negotiate') actions.negotiateStrike(w);
  else if (name === 'open-debt') openWin('debt');
  else if (name === 'default') actions.defaultNow(w);
  else if (name === 'restructure') actions.restructure(w, +$('#haircut').value);
  else if (name === 'settle') actions.settleHoldouts(w);
  else if (name === 'deselect') { G.selected = iso.selected = null; }
  else if (name === 'reset-budget') { for (const [k] of [...TAX_ROWS, ...SPEND_ROWS]) w.policy[k] = G.base[k]; renderBudget(); }
  else if (name === 'export') exportGame();
  else if (name === 'continue') { closeWins(); setSpeed(G.resume); }
  else if (name === 'new') { openWin('new'); return; }
  const fresh = w.events.slice(G.seenEvents);
  G.seenEvents = w.events.length;
  handleEvents(fresh);
  refresh();
}

// ------------------------------------------------------------ arranque

function init() {
  buildLayers();
  buildChartPicks();
  $('#new-preset').innerHTML = STRATEGIES.filter((s) => !s.dynamic).map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
  try { $('#new-ideology').value = localStorage.getItem('bc-ideology') ?? ''; } catch { /* sin almacenamiento */ }

  for (const b of $$('.g-speed button')) b.addEventListener('click', () => setSpeed(+b.dataset.speed));
  for (const b of $$('.g-tools button')) b.addEventListener('click', () => ($(`#win-${b.dataset.win}`).hidden ? openWin(b.dataset.win) : closeWins()));
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeWins();
    const a = e.target.closest('[data-act]');
    if (a) act(a.dataset.act);
    const c = e.target.closest('[data-chart]');
    if (c) showAdvice(c.dataset.chart);
    if (e.target.closest('[data-dismiss]') || c?.closest('.toast')) e.target.closest('.toast')?.remove();
  });
  $('#advisors-body').addEventListener('change', (e) => { if (e.target.id === 'pause-red') G.pauseOnRed = e.target.checked; });
  bindControls($('#budget-body'), renderBudget);
  $('#laws-body').addEventListener('input', (e) => {
    const law = e.target.closest('.law[data-k]');
    if (law) { setPolicy(G.w, { [law.dataset.k]: +e.target.value }); law.querySelector('b').textContent = fmtLever(lever(law.dataset.k), +e.target.value); }
  });
  $('#laws-body').addEventListener('change', (e) => { if (e.target.dataset.tog) setPolicy(G.w, { [e.target.dataset.tog]: e.target.checked }); });
  $('#debt-body').addEventListener('input', (e) => { if (e.target.id === 'haircut') $('#haircut-v').textContent = `${Math.round(e.target.value * 100)}%`; });
  $('#new-go').addEventListener('click', () => {
    const ideology = $('#new-ideology').value;
    try { localStorage.setItem('bc-ideology', ideology); } catch { /* sin almacenamiento */ }
    newGame({ seed: Math.max(1, +$('#new-seed').value || 1), preset: $('#new-preset').value, ideology });
    closeWins();
    setSpeed(2);
  });
  addEventListener('keydown', (e) => {
    if (e.target.matches?.('input, select')) return;
    if (e.code === 'Space') { e.preventDefault(); setSpeed(G.speed ? 0 : G.resume); }
    if (e.key === 'Escape') closeWins();
    const k = { a: 'advisors', b: 'budget', l: 'laws', d: 'debt', g: 'charts', p: 'news' }[e.key.toLowerCase()];
    if (k) openWin(k);
    if (e.key === '+' || e.key === '=') iso.zoomBy(1.25);
    if (e.key === '-') iso.zoomBy(0.8);
    if (e.key === '0') iso.recenter();
  });
  $('.g-zoom').addEventListener('click', (e) => {
    const z = e.target.closest('button')?.dataset.zoom;
    if (z === 'in') iso.zoomBy(1.25);
    else if (z === 'out') iso.zoomBy(0.8);
    else if (z === 'fit') iso.recenter();
  });

  iso.onSelect = (id) => { G.selected = iso.selected = id; renderRegion(); };
  iso.onHover = (t, x, y) => {
    const tip = $('#g-tip');
    const r = t && G.w.regions.find((q) => q.id === t.region);
    if (!t || (!r && t.region !== 'vecino')) { tip.hidden = true; return; }
    tip.hidden = false;
    tip.innerHTML = r
      ? `<b>${r.name}</b><br>Desempleo ${pct(r.u)} · informalidad ${pct(r.informality, 0)}<br>Crimen ${Math.round((r.crime / r.crimeBase) * 100)} · salud ${r.health.toFixed(2)}<br><span class="muted">Clic para ver y priorizar inversión</span>`
      : `<b>País vecino estable</b><br>${G.w.relocated.length} empresas se mudaron aquí`;
    tip.style.left = `${Math.min(x + 14, $('#g-stage').clientWidth - 250)}px`;
    tip.style.top = `${y + 14}px`;
  };

  newGame({});
  setSpeed(0);
  openWin('new');
  requestAnimationFrame(loop);
}

init();
