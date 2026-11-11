// Interfaz del laboratorio: palancas, tablero de regiones, gráficas y experimentos.
import { createWorld, step, setPolicy, actions } from './model.js';
import { DEFAULT_POLICY, LEVERS, TOGGLES, SECTORS, SECTOR_KEYS, LENDER_TYPES } from './config.js';
import { STRATEGIES, monteCarlo, lafferScan } from './experiments.js';
import * as Debt from './debt.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const pct = (x, d = 1) => (x == null || Number.isNaN(x) ? '–' : `${(x * 100).toFixed(d)}%`);
const num = (x, d = 0) => (x == null || Number.isNaN(x) ? '–' : x.toLocaleString('es-CO', { maximumFractionDigits: d, minimumFractionDigits: d }));
const PALETTE = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#9c755f'];

const ui = {
  w: null,
  policy: { ...DEFAULT_POLICY },
  playing: false,
  timer: null,
  charts: {},
  docLoaded: false,
  tab: 'sim',
};

// ---------------------------------------------------------------- palancas

function fmtLever(l, v) {
  if (l.unit === 'pct') return pct(v, 0);
  if (l.unit === 'pib') return pct(v, v < 0.01 ? 2 : 1);
  if (l.unit === 'x') return `${v.toFixed(2)}×`;
  return v.toFixed(2);
}

function buildLevers() {
  const box = $('#levers');
  box.innerHTML = '<h2>Palancas de política</h2>';
  let group = null;
  for (const l of LEVERS) {
    if (l.group !== group) {
      group = l.group;
      box.insertAdjacentHTML('beforeend', `<div class="lever-group">${group}</div>`);
    }
    box.insertAdjacentHTML('beforeend', `
      <div class="lever" title="${l.help ?? ''}">
        <div class="lab"><span>${l.label}</span><span class="val" id="val-${l.key}"></span></div>
        <input type="range" id="lv-${l.key}" min="${l.min}" max="${l.max}" step="${l.step}">
      </div>`);
    $(`#lv-${l.key}`).addEventListener('input', (e) => {
      const v = Number(e.target.value);
      ui.policy[l.key] = v;
      if (ui.w) setPolicy(ui.w, { [l.key]: v });
      paintLever(l);
    });
  }
  const tg = $('#toggles');
  tg.innerHTML = '<h2>Reglas de la deuda</h2>';
  for (const t of TOGGLES) {
    tg.insertAdjacentHTML('beforeend', `
      <label class="toggle"><input type="checkbox" id="tg-${t.key}">
        <span>${t.label}<small>${t.help}</small></span></label>`);
    $(`#tg-${t.key}`).addEventListener('change', (e) => {
      ui.policy[t.key] = e.target.checked;
      if (ui.w) setPolicy(ui.w, { [t.key]: e.target.checked });
    });
  }
  const sel = $('#preset');
  sel.innerHTML = STRATEGIES.filter((s) => !s.dynamic).map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
  sel.addEventListener('change', () => applyPreset(sel.value));
  $('#preset-desc').textContent = STRATEGIES[0].desc;
}

function paintLever(l) {
  const v = ui.policy[l.key];
  const el = $(`#val-${l.key}`);
  el.textContent = fmtLever(l, v);
  el.classList.toggle('changed', Math.abs(v - DEFAULT_POLICY[l.key]) > 1e-9);
}

function syncLevers() {
  for (const l of LEVERS) { $(`#lv-${l.key}`).value = ui.policy[l.key]; paintLever(l); }
  for (const t of TOGGLES) $(`#tg-${t.key}`).checked = !!ui.policy[t.key];
}

function applyPreset(id) {
  const s = STRATEGIES.find((x) => x.id === id);
  ui.policy = { ...DEFAULT_POLICY, ...s.policy, pledge: ui.policy.pledge, cac: ui.policy.cac, autopilot: ui.policy.autopilot };
  if (ui.w) setPolicy(ui.w, ui.policy);
  $('#preset-desc').textContent = s.desc + (ui.w && ui.w.t > 0 ? ' (Cambiar de política a mitad de partida cuenta como reforma.)' : '');
  syncLevers();
}

// ---------------------------------------------------------------- juego

function newGame() {
  stop();
  const seed = Number($('#seed').value) || 1;
  ui.w = createWorld({ seed, policy: ui.policy });
  render();
}

function tick() {
  step(ui.w);
  render();
}

function play() {
  ui.playing = true;
  $('#btn-play').textContent = '❚❚ Pausa';
  const ms = 1100 - Number($('#speed').value) * 100;
  ui.timer = setInterval(tick, ms);
}

function stop() {
  ui.playing = false;
  $('#btn-play').textContent = '▶ Jugar';
  clearInterval(ui.timer);
}

function bindControls() {
  $('#btn-play').addEventListener('click', () => (ui.playing ? stop() : play()));
  $('#btn-step').addEventListener('click', () => { stop(); tick(); });
  $('#btn-reset').addEventListener('click', newGame);
  $('#speed').addEventListener('input', () => { if (ui.playing) { stop(); play(); } });
  $('#haircut').addEventListener('input', (e) => { $('#haircut-val').textContent = pct(Number(e.target.value), 0); });
  $('#btn-default').addEventListener('click', () => { actions.defaultNow(ui.w); render(); });
  $('#btn-restructure').addEventListener('click', () => { actions.restructure(ui.w, Number($('#haircut').value)); render(); });
  $('#btn-settle').addEventListener('click', () => { actions.settleHoldouts(ui.w); render(); });
  $('#btn-export').addEventListener('click', exportGame);
  const ideo = $('#ideology');
  try { ideo.value = localStorage.getItem('bc-ideology') ?? ''; } catch { /* sin almacenamiento */ }
  ideo.addEventListener('change', () => { try { localStorage.setItem('bc-ideology', ideo.value); } catch { /* sin almacenamiento */ } });
  $$('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#btn-laffer').addEventListener('click', runLaffer);
  $('#btn-mc').addEventListener('click', runMC);
  $('#btn-ablate').addEventListener('click', runAblation);
  $('#ablate-key').innerHTML = STRATEGIES.filter((s) => Object.keys(s.policy).length).map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
}

function showTab(tab) {
  ui.tab = tab;
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab').forEach((s) => { s.hidden = s.id !== `tab-${tab}`; });
  if (tab === 'doc') loadDoc();
  render();
}

function exportGame() {
  const w = ui.w;
  const data = {
    version: 1,
    ideology: $('#ideology').value || null,
    seed: w.seed,
    quarters: w.t,
    outcome: w.outcome,
    finalPolicy: w.policy,
    policyPath: w.policyHist,
    history: w.hist.map(({ t, gdp, growth, u, informality, poverty, inflation, debtGDP, spread, rating, status, deficit, approval, relocatedTotal }) =>
      ({ t, gdp, growth, u, informality, poverty, inflation, debtGDP, spread, rating, status, deficit, approval, relocatedTotal })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `broken-countries-semilla${w.seed}-t${w.t}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------- render

function render() {
  const w = ui.w;
  const h = w.hist;
  const r = h[h.length - 1];
  const year = Math.floor(w.t / 4);
  $('#clock-t').textContent = `Año ${year} · T${w.t}`;
  const st = $('#clock-status');
  const statusText = { normal: r.rating, default: 'DEFAULT', holdouts: 'Litigio con holdouts' }[w.debt.status];
  st.textContent = w.debt.status === 'normal' ? `Calificación ${statusText}` : statusText;
  st.className = `chip ${w.debt.status !== 'normal' ? 'bad' : ['B', 'CCC', 'CC'].includes(r.rating) ? 'warn' : ''}`;
  renderBanner();
  renderCrisis();
  renderEvents();
  if (ui.tab === 'sim') { renderKPIs(); renderMap(); renderSimCharts(); }
  if (ui.tab === 'scp') renderSCP();
  if (ui.tab === 'debt') renderDebt();
}

function renderBanner() {
  const o = ui.w.outcome;
  const msgs = [];
  if (o.default != null) msgs.push(`País quebrado en el trimestre ${o.default}`);
  if (o.estallido != null) msgs.push(`estallido social en el trimestre ${o.estallido}`);
  if (o.lostElection != null) msgs.push(`perdiste las elecciones del trimestre ${o.lostElection}`);
  const b = $('#banner');
  b.hidden = msgs.length === 0;
  b.textContent = msgs.length ? `${msgs.join(' · ')}. La simulación sigue para que veas las consecuencias.` : '';
}

function renderCrisis() {
  const d = ui.w.debt;
  const txt = {
    normal: `Spread ${Math.round(d.spread * 10000)} pb · prob. de default percibida ${pct(d.pConsensus)} anual.`,
    default: `En default desde T${d.defaultSince}. Sin acceso al mercado: el déficit se cubre con recortes o emisión.`,
    holdouts: `Holdouts reclaman ${num(d.holdouts / Debt.annualGDPnom(ui.w) * 100, 1)}% del PIB y bloquean nuevos créditos.`,
  }[d.status];
  $('#crisis-text').textContent = txt + (d.pledged ? ' Regalías pignoradas.' : '');
  $('#btn-default').disabled = d.status !== 'normal';
  $('#btn-restructure').disabled = d.status !== 'default';
  $('#btn-settle').disabled = d.status !== 'holdouts';
}

function renderEvents() {
  const ev = ui.w.events.slice(-80).reverse();
  $('#events').innerHTML = ev.map((e) => `<li class="${e.kind}"><div class="t">Año ${Math.floor(e.t / 4)} · T${e.t}</div>${e.text}</li>`).join('');
}

function kpi(k, v, d = '', cls = '') {
  return `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="d ${cls}">${d}</div></div>`;
}

function renderKPIs() {
  const h = ui.w.hist;
  const r = h[h.length - 1], r0 = h[0];
  const delta = (a, b, good = 'up', d = 1) => {
    const x = (a - b) * 100;
    if (Math.abs(x) < 0.05) return ['=', ''];
    const better = good === 'up' ? x > 0 : x < 0;
    return [`${x > 0 ? '+' : ''}${x.toFixed(d)} pp vs. inicio`, better ? 'up' : 'down'];
  };
  const [du, cu] = delta(r.u, r0.u, 'down');
  const [di, ci] = delta(r.informality, r0.informality, 'down');
  const [dp, cp] = delta(r.poverty, r0.poverty, 'down');
  const [dd, cd] = delta(r.debtGDP, r0.debtGDP, 'down');
  const [da, ca] = delta(r.approval, r0.approval, 'up');
  $('#kpis').innerHTML = [
    kpi('PIB (billones/año)', num(r.gdp), `crec. ${pct(r.growth)}`, r.growth >= 0 ? 'up' : 'down'),
    kpi('Desempleo', pct(r.u), du, cu),
    kpi('Informalidad', pct(r.informality, 0), di, ci),
    kpi('Pobreza', pct(r.poverty, 0), dp, cp),
    kpi('Inflación', pct(r.inflation), '', r.inflation > 0.06 ? 'down' : ''),
    kpi('Deuda / PIB', pct(r.debtGDP, 0), dd, cd),
    kpi('Spread', r.spread == null ? '—' : `${Math.round(r.spread * 10000)} pb`, r.rating),
    kpi('Déficit', pct(r.deficit), r.deficit != null ? `recaudo ${pct(r.revenue)}` : ''),
    kpi('Aprobación', pct(r.approval, 0), da, ca),
    kpi('Empresas', num(r.firms), `+${r.entries} / −${r.exits} este trim.`),
    kpi('Se fueron al vecino', num(r.relocatedTotal), 'acumulado'),
  ].join('');
}

function renderMap() {
  const w = ui.w;
  const byRegion = w.regions.map(() => []);
  for (const f of w.firms) byRegion[f.region].push(f);
  const dots = (list, ghost = false) => list
    .slice().sort((a, b) => SECTOR_KEYS.indexOf(a.sector) - SECTOR_KEYS.indexOf(b.sector))
    .map((f) => `<i class="dot${ghost ? ' ghost' : ''}" style="background:${SECTORS[f.sector].color}" title="${SECTORS[f.sector].name}"></i>`).join('');
  const bar = (label, v) => `<span>${label}</span><span class="bar"><i style="width:${Math.min(100, v * 100).toFixed(0)}%"></i></span>`;
  const tiles = w.regions.map((r, i) => {
    const heat = Math.min(1, Math.max(0, (r.u - 0.05) / 0.2));
    return `<div class="tile" style="grid-area:${r.id}; box-shadow: inset 0 0 0 999px hsla(${(1 - heat) * 120}, 70%, 50%, 0.10)">
      <div class="name">${r.name}</div>
      <div class="stats">
        <span>Desempleo <b>${pct(r.u)}</b></span><span>Informal <b>${pct(r.informality, 0)}</b></span>
        <span>Demanda <b>${r.d.toFixed(2)}</b></span><span>Costo capital <b>${pct(r.rcap)}</b></span>
      </div>
      <div class="bars">${bar('Infraestructura', r.infra)}${bar('Capital humano', r.hc)}${bar('Seguridad', r.sec)}</div>
      <div class="dots">${dots(byRegion[i])}</div>
    </div>`;
  });
  tiles.push(`<div class="tile" style="grid-area:vecino">
    <div class="name">${'País vecino estable'} · renta 25%, sin reformas</div>
    <div class="stats"><span>Empresas que se fueron <b>${w.relocated.length}</b></span><span>Te venden desde allá con arancel</span></div>
    <div class="dots">${dots(w.relocated, true)}</div>
  </div>`);
  $('#map').innerHTML = tiles.join('');
  $('#legend').innerHTML = '<h2>Sectores</h2>' + SECTOR_KEYS.map((k) => `<span><i class="dot" style="background:${SECTORS[k].color}"></i>${SECTORS[k].name}</span>`).join('')
    + '<p class="hint">Cada cuadrito es una empresa. El color de fondo de la región va de verde (poco desempleo) a rojo.</p>';
}

// ---------------------------------------------------------------- gráficas

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function setupChartDefaults() {
  Chart.defaults.color = cssVar('--muted');
  Chart.defaults.borderColor = cssVar('--grid');
  Chart.defaults.font.family = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  Chart.defaults.font.size = 11;
  Chart.defaults.animation = false;
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.elements.point.radius = 0;
  Chart.defaults.elements.line.borderWidth = 2;
  Chart.defaults.maintainAspectRatio = false;
}

const pctAxis = (extra = {}) => ({ ticks: { callback: (v) => `${Math.round(v * 1000) / 10}%` }, ...extra });

function lineChart(id, datasets, opts = {}) {
  if (ui.charts[id]) return ui.charts[id];
  ui.charts[id] = new Chart($(`#${id}`), {
    type: 'line',
    data: { labels: [], datasets },
    options: { interaction: { mode: 'index', intersect: false }, scales: { x: { ticks: { maxTicksLimit: 10 } }, y: pctAxis() }, ...opts },
  });
  return ui.charts[id];
}

function feed(chart, labels, series) {
  chart.data.labels = labels;
  chart.data.datasets.forEach((ds, i) => { ds.data = series[i]; });
  chart.update('none');
}

const labelsOf = (h) => h.map((r) => (r.t % 4 === 0 ? `A${r.t / 4}` : `T${r.t}`));

function renderSimCharts() {
  const h = ui.w.hist;
  const L = labelsOf(h);
  feed(lineChart('ch-debt', [
    { label: 'Deuda / PIB', borderColor: PALETTE[0], yAxisID: 'y' },
    { label: 'Spread', borderColor: PALETTE[2], yAxisID: 'y1' },
    { label: 'Prob. default anual', borderColor: PALETTE[1], yAxisID: 'y1', borderDash: [4, 3] },
  ], { scales: { x: { ticks: { maxTicksLimit: 10 } }, y: pctAxis({ position: 'left' }), y1: pctAxis({ position: 'right', grid: { drawOnChartArea: false } }) } }),
  L, [h.map((r) => r.debtGDP), h.map((r) => r.spread), h.map((r) => r.pDefault)]);

  const taxes = [['corp', 'Renta'], ['vat', 'IVA'], ['payroll', 'Nómina'], ['royalty', 'Regalías'], ['tariff', 'Aranceles'], ['other', 'Otros']];
  feed(lineChart('ch-rev', [
    ...taxes.map(([, name], i) => ({ label: name, borderColor: PALETTE[i], backgroundColor: PALETTE[i] + '88', fill: i === 0 ? 'origin' : '-1', borderWidth: 1, stack: 'tax' })),
    { label: 'Déficit', borderColor: cssVar('--ink'), borderDash: [5, 3], fill: false, stack: 'def' },
  ], { scales: { x: { ticks: { maxTicksLimit: 10 } }, y: pctAxis({ stacked: true }) } }),
  L, [...taxes.map(([k]) => h.map((r) => r[k])), h.map((r) => r.deficit)]);

  feed(lineChart('ch-social', [
    { label: 'Desempleo', borderColor: PALETTE[2] },
    { label: 'Informalidad', borderColor: PALETTE[5] },
    { label: 'Pobreza', borderColor: PALETTE[6] },
    { label: 'Inflación', borderColor: PALETTE[0] },
  ]), L, [h.map((r) => r.u), h.map((r) => r.informality), h.map((r) => r.poverty), h.map((r) => r.inflation)]);

  feed(lineChart('ch-approval', [
    { label: 'Aprobación', borderColor: PALETTE[0], yAxisID: 'y' },
    { label: 'Umbral para reelegirse', borderColor: PALETTE[2], borderDash: [4, 3], borderWidth: 1, yAxisID: 'y' },
    { label: 'PIB (billones/año)', borderColor: PALETTE[4], yAxisID: 'y1' },
  ], { scales: { x: { ticks: { maxTicksLimit: 10 } }, y: pctAxis({ min: 0, max: 1 }), y1: { position: 'right', grid: { drawOnChartArea: false } } } }),
  L, [h.map((r) => r.approval), h.map(() => 0.4), h.map((r) => r.gdp)]);
}

function renderSCP() {
  const w = ui.w, h = w.hist;
  const flows = (k) => {
    let e = 0;
    for (let i = Math.max(1, h.length - 4); i < h.length; i++) { e += h[i].bySector[k] - h[i - 1].bySector[k]; }
    return e;
  };
  const inf = (k) => {
    const list = w.firms.filter((f) => f.sector === k);
    const q = list.reduce((a, f) => a + f.q, 0);
    return q > 0 ? list.reduce((a, f) => a + f.e * f.q, 0) / q : 0;
  };
  const rows = SECTOR_KEYS.map((k) => {
    const s = w.sectors[k];
    return `<tr><td><i class="dot" style="display:inline-block;background:${SECTORS[k].color}"></i> ${SECTORS[k].name}</td>
      <td>${s.n}</td><td>${num(s.hhi)}</td><td>${pct(s.importShare, 0)}</td><td>${s.entryBarrier.toFixed(2)}</td><td>${s.barrier.toFixed(2)}</td>
      <td>${pct(s.lerner)}</td><td>${pct(inf(k), 0)}</td><td>${flows(k) >= 0 ? '+' : ''}${flows(k)}</td></tr>`;
  }).join('');
  $('#scp-table').innerHTML = `<thead><tr><th>Sector</th><th>Empresas</th><th>HHI</th><th>Importaciones</th><th>Barrera de entrada</th><th>…de ella, por cabildeo</th><th>Lerner</th><th>Informalidad</th><th>Cambio neto (1 año)</th></tr></thead><tbody>${rows}</tbody>`;
  const L = labelsOf(h);
  const ch = lineChart('ch-firms', SECTOR_KEYS.map((k, i) => ({ label: SECTORS[k].name, borderColor: SECTORS[k].color, backgroundColor: SECTORS[k].color + '99', fill: i === 0 ? 'origin' : '-1', borderWidth: 1 })),
    { scales: { x: { ticks: { maxTicksLimit: 10 } }, y: { stacked: true } } });
  feed(ch, L, SECTOR_KEYS.map((k) => h.map((r) => r.bySector[k])));
  if (!ui.charts['ch-flows']) {
    ui.charts['ch-flows'] = new Chart($('#ch-flows'), {
      type: 'bar',
      data: { labels: [], datasets: [
        { label: 'Entradas', backgroundColor: PALETTE[4] },
        { label: 'Salidas', backgroundColor: PALETTE[2] },
        { label: 'Se fueron al vecino', backgroundColor: PALETTE[1] },
      ] },
      options: { scales: { x: { ticks: { maxTicksLimit: 10 } } } },
    });
  }
  feed(ui.charts['ch-flows'], L, [h.map((r) => r.entries), h.map((r) => -r.exits), h.map((r) => -r.relocations)]);
  feed(lineChart('ch-lerner', SECTOR_KEYS.map((k) => ({ label: SECTORS[k].name, borderColor: SECTORS[k].color }))), L, SECTOR_KEYS.map((k) => h.map((r) => r.lerner[k])));
  feed(lineChart('ch-barrier', SECTOR_KEYS.map((k) => ({ label: SECTORS[k].name, borderColor: SECTORS[k].color })), { scales: { x: { ticks: { maxTicksLimit: 10 } }, y: {} } }),
    L, SECTOR_KEYS.map((k) => h.map((r) => r.barrier[k])));
}

function renderDebt() {
  const w = ui.w, h = w.hist;
  const L = labelsOf(h);
  const types = Object.keys(LENDER_TYPES);
  feed(lineChart('ch-lenders', types.map((t, i) => ({ label: LENDER_TYPES[t].name, borderColor: LENDER_TYPES[t].color, backgroundColor: LENDER_TYPES[t].color + '99', fill: i === 0 ? 'origin' : '-1', borderWidth: 1 })),
    { scales: { x: { ticks: { maxTicksLimit: 10 } }, y: pctAxis({ stacked: true, min: 0, max: 1 }) } }),
  L, types.map((t) => h.map((r) => r.lenders[t]?.share ?? 0)));
  feed(lineChart('ch-spread', [
    { label: 'Spread exigido', borderColor: PALETTE[2] },
    { label: 'Prob. default (consenso)', borderColor: PALETTE[0] },
  ]), L, [h.map((r) => r.spread), h.map((r) => r.pDefault)]);
  const z = Debt.commonZ(w);
  const sig = (x) => 1 / (1 + Math.exp(-x));
  const MV = Debt.marketValue(w);
  const ann = Debt.annualGDPnom(w);
  const rows = [...w.lenders].sort((a, b) => b.h - a.h).map((L) => {
    const T = LENDER_TYPES[L.type];
    return `<tr><td><i class="dot" style="display:inline-block;background:${T.color}"></i> ${T.name} #${L.id}</td>
      <td>${pct(L.W, 1)}</td><td>${pct(sig(z + L.bias), 1)}</td><td>${T.gamma}</td><td>${pct(T.rec, 0)}</td>
      <td>${pct(L.h, 1)}</td><td>${pct((L.h * MV) / ann, 1)}</td><td>T${L.since}</td></tr>`;
  }).join('');
  const v = w.debt.vulture;
  $('#lender-table').innerHTML = `<thead><tr><th>Prestamista</th><th>Capital (% PIB)</th><th>Su prob. de default</th><th>Aversión al riesgo γ</th><th>Recuperación esperada</th><th>Parte de la deuda</th><th>Tenencia (% PIB)</th><th>Llegó</th></tr></thead><tbody>${rows}</tbody>`
    + (v.cost > 0 ? `<caption class="hint" style="caption-side:bottom;text-align:left">Fondos buitre: compraron bonos por ${pct(v.cost / ann, 1)} del PIB con valor nominal de ${pct(v.face / ann, 1)}; han cobrado ${pct(v.paid / ann, 1)}.</caption>` : '');
}

// ---------------------------------------------------------------- experimentos

async function runLaffer() {
  const btn = $('#btn-laffer');
  btn.disabled = true;
  const key = $('#laffer-key').value;
  const res = await lafferScan({ key, basePolicy: { ...ui.policy }, seeds: Number($('#laffer-seeds').value) || 3, onProgress: (p) => { $('#laffer-progress').style.width = `${p * 100}%`; } });
  btn.disabled = false;
  const pts = res.pts;
  const fit = res.fit;
  const fitPts = fit ? pts.map((p) => ({ x: p.rate, y: fit.a * p.rate + fit.b * p.rate ** 2 })) : [];
  if (ui.charts['ch-laffer']) ui.charts['ch-laffer'].destroy();
  ui.charts['ch-laffer'] = new Chart($('#ch-laffer'), {
    type: 'scatter',
    data: { datasets: [
      { label: 'Recaudo de este impuesto (billones/año)', data: pts.map((p) => ({ x: p.rate, y: p.own })), backgroundColor: PALETTE[0], pointRadius: 4 },
      { label: 'Ajuste cuadrático', type: 'line', data: fitPts, borderColor: PALETTE[0], borderDash: [5, 3] },
      { label: 'Recaudo total (billones/año)', data: pts.map((p) => ({ x: p.rate, y: p.total })), backgroundColor: PALETTE[1], pointRadius: 3, yAxisID: 'y1' },
    ] },
    options: { scales: {
      x: { type: 'linear', ticks: { callback: (v) => `${Math.round(v * 100)}%` }, title: { display: true, text: 'Tasa' } },
      y: { title: { display: true, text: 'Recaudo del impuesto' } },
      y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Recaudo total' } },
    } },
  });
  const best = pts.reduce((a, b) => (b.own > a.own ? b : a));
  const bestTot = pts.reduce((a, b) => (b.total > a.total ? b : a));
  $('#laffer-result').textContent = `Máximo observado del impuesto en ${pct(best.rate, 0)}`
    + (fit?.peak ? ` · pico de la parábola en ${pct(fit.peak, 0)}` : '')
    + ` · el recaudo total se maximiza en ${pct(bestTot.rate, 0)} (los demás impuestos también pierden base).`;
}

async function runMC() {
  const btn = $('#btn-mc');
  btn.disabled = true;
  const res = await monteCarlo({
    runs: Number($('#mc-runs').value) || 40,
    quarters: Number($('#mc-q').value) || 32,
    customPolicy: $('#mc-custom').checked ? { ...ui.policy } : null,
    onProgress: (p) => { $('#mc-progress').style.width = `${p * 100}%`; },
  });
  $('#mc-progress').style.width = '100%';
  btn.disabled = false;
  if (ui.charts['ch-mc']) ui.charts['ch-mc'].destroy();
  ui.charts['ch-mc'] = new Chart($('#ch-mc'), {
    type: 'bar',
    data: { labels: res.map((r) => r.name), datasets: [
      { label: 'País quebrado (default)', data: res.map((r) => r.defaultRate), backgroundColor: PALETTE[2] },
      { label: 'Estallido social', data: res.map((r) => r.estallidoRate), backgroundColor: PALETTE[1] },
      { label: 'Pierde elecciones', data: res.map((r) => r.lostElectionRate), backgroundColor: PALETTE[0] },
    ] },
    options: { scales: { y: pctAxis({ min: 0, max: 1 }) } },
  });
  const cls = (x, bad, good) => (x >= bad ? 'bad' : x <= good ? 'good' : '');
  $('#mc-table').innerHTML = `<thead><tr><th>Paquete</th><th>Default</th><th>Estallido</th><th>Pierde elecciones</th><th>Deuda final</th><th>Crec. anual</th><th>Desempleo</th><th>Informalidad</th><th>Pobreza</th><th>Inflación</th><th>Aprobación</th><th>Empresas idas</th></tr></thead><tbody>`
    + res.map((r) => `<tr title="${r.desc ?? ''}"><td>${r.name}</td><td class="${cls(r.defaultRate, 0.3, 0.05)}">${pct(r.defaultRate, 0)}</td><td class="${cls(r.estallidoRate, 0.3, 0.05)}">${pct(r.estallidoRate, 0)}</td>
      <td class="${cls(r.lostElectionRate, 0.6, 0.2)}">${pct(r.lostElectionRate, 0)}</td><td>${pct(r.debtGDP, 0)}</td><td>${pct(r.growth)}</td><td>${pct(r.u)}</td><td>${pct(r.informality, 0)}</td><td>${pct(r.poverty, 0)}</td><td>${pct(r.inflation)}</td><td>${pct(r.approval, 0)}</td><td>${r.relocated}</td></tr>`).join('')
    + '</tbody><caption class="hint" style="caption-side:bottom;text-align:left">Medianas entre partidas. Las tasas cuentan si el evento pasó al menos una vez en el horizonte.</caption>';
}

async function runAblation() {
  const s = STRATEGIES.find((x) => x.id === $('#ablate-key').value);
  const btn = $('#btn-ablate');
  btn.disabled = true;
  const list = [{ id: 'base', name: 'Statu quo', policy: {} }, ...Object.entries(s.policy).map(([k, v]) => {
    const l = LEVERS.find((x) => x.key === k);
    return { id: k, name: `Solo ${l ? l.label.toLowerCase() : k}: ${l ? fmtLever(l, DEFAULT_POLICY[k]) : DEFAULT_POLICY[k]} → ${l ? fmtLever(l, v) : v}`, policy: { [k]: v } };
  }), { id: 'all', name: `Paquete completo: ${s.name}`, policy: s.policy }];
  const res = await monteCarlo({ strategies: list, runs: 30, quarters: 32, onProgress: (p) => { $('#ablate-progress').style.width = `${p * 100}%`; } });
  btn.disabled = false;
  const base = res[0].defaultRate;
  $('#ablate-table').innerHTML = `<thead><tr><th>Cambio</th><th>Default</th><th>vs. statu quo</th><th>Deuda final</th><th>Informalidad</th><th>Pobreza</th><th>Aprobación</th></tr></thead><tbody>`
    + res.map((r) => {
      const dlt = r.defaultRate - base;
      return `<tr><td>${r.name}</td><td>${pct(r.defaultRate, 0)}</td><td class="${dlt > 0.1 ? 'bad' : dlt < -0.05 ? 'good' : ''}">${dlt >= 0 ? '+' : ''}${Math.round(dlt * 100)} pp</td><td>${pct(r.debtGDP, 0)}</td><td>${pct(r.informality, 0)}</td><td>${pct(r.poverty, 0)}</td><td>${pct(r.approval, 0)}</td></tr>`;
    }).join('') + '</tbody>';
}

// ---------------------------------------------------------------- documento

async function loadDoc() {
  if (ui.docLoaded) return;
  try {
    const md = await (await fetch('docs/MODELO.md')).text();
    const blocks = [];
    const keep = (tex, display) => { blocks.push({ tex, display }); return `@@M${blocks.length - 1}@@`; };
    const safe = md
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => keep(t, true))
      .replace(/\$([^$\n]+?)\$/g, (_, t) => keep(t, false));
    let html = marked.parse(safe);
    html = html.replace(/@@M(\d+)@@/g, (_, i) => katex.renderToString(blocks[+i].tex, { displayMode: blocks[+i].display, throwOnError: false }));
    $('#doc').innerHTML = html;
    ui.docLoaded = true;
  } catch (err) {
    $('#doc').textContent = `No se pudo cargar docs/MODELO.md (${err.message}). Abre la página desde un servidor (no como archivo).`;
  }
}

function renderInlineMath() {
  for (const el of $$('.math')) katex.render(el.dataset.tex, el, { throwOnError: false });
}

// ---------------------------------------------------------------- inicio

setupChartDefaults();
buildLevers();
syncLevers();
bindControls();
renderInlineMath();
newGame();
