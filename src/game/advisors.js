// Consejo de asesores: leen las señales tempranas del modelo y dicen qué gráfica mirar.
// Cada asesor devuelve un nivel (0 tranquilo, 1 atención, 2 alarma), lo que dice y las series que lo muestran.
import { P, RATINGS } from '../config.js';

const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const pp = (x) => `${Math.abs(x * 100).toFixed(1)} puntos`;

// Cambio en un año (4 trimestres) de una serie del historial.
function delta(hist, k, n = 4) {
  const a = hist.at(-1)?.[k], b = hist.at(-1 - n)?.[k];
  return a == null || b == null ? 0 : a - b;
}
const avg = (hist, k, n = 4) => {
  const v = hist.slice(-n).map((r) => r[k]).filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
};

function hacienda(w, h, hist) {
  const def = avg(hist, 'deficit'), dDebt = delta(hist, 'debtGDP');
  const years = dDebt > 0.005 ? (0.8 - h.debtGDP) / dDebt : Infinity;
  const level = def >= 0.07 || h.debtGDP > 0.8 ? 2 : def >= 0.05 || dDebt > 0.03 ? 1 : 0;
  const say = level === 0
    ? `Las cuentas aguantan: déficit de ${pct(def)} del PIB y deuda en ${pct(h.debtGDP, 0)}.`
    : `El déficit va en ${pct(def)} del PIB y la deuda ${dDebt > 0 ? `sube ${pp(dDebt)} por año` : 'no baja'}.` +
      (isFinite(years) && years > 0 && years < 8 ? ` A este ritmo llega a 80% en ${Math.max(1, Math.round(years))} año${Math.round(years) === 1 ? '' : 's'}.` : '') +
      ' Sube recaudo o baja gasto antes de que lo note el mercado.';
  return { id: 'hacienda', icon: '💼', name: 'Hacienda', level, say, series: ['deficit', 'debtGDP', 'revenue'], refs: [{ v: 5, label: 'Déficit de alerta (5%)' }] };
}

function credito(w, h, hist) {
  const d = w.debt;
  if (d.status === 'default') {
    return { id: 'credito', icon: '🏦', name: 'Crédito público', level: 2, say: 'Estamos en default: nadie nos presta. Hay que ofrecer una reestructuración en la ventana de Deuda.', series: ['spread', 'debtGDP', 'inflation'], refs: [] };
  }
  if (d.status === 'holdouts') {
    return { id: 'credito', icon: '🏦', name: 'Crédito público', level: 1, say: 'Los holdouts litigan y bloquean el acceso al mercado. Pagarles cuesta, pero reabre el crédito.', series: ['spread', 'debtGDP'], refs: [] };
  }
  const idx = RATINGS.findIndex(([, r]) => r === h.rating);
  const next = RATINGS[idx + 1]?.[1], th = RATINGS[idx]?.[0];
  const dSpread = delta(hist, 'spread');
  const bridge = h.bridgeQ >= 1 && hist.at(-1).bridgeQ > (hist.at(-2)?.bridgeQ ?? 0);
  let level = 0, say;
  if (h.cushion == null) {
    say = 'Todavía no hemos salido a refinanciar: espera el primer trimestre.';
  } else if (bridge || h.cushion < 1.05) {
    level = 2;
    say = bridge
      ? `Los mercados se cerraron y vivimos del puente del multilateral. Si el próximo trimestre no baja el déficit, entramos en default.`
      : `El mercado apenas cubre ${pct(h.cushion, 0)} de lo que hay que refinanciar. Cualquier mala noticia cierra la puerta.`;
  } else if (h.cushionDown != null && h.cushionDown < 1 && next) {
    level = 1;
    say = `Estamos a una nota del precipicio: si nos bajan a ${next}, los fondos con mandato tienen que vender y el mercado cubriría solo ${pct(h.cushionDown, 0)} de lo que necesitamos. ` +
      `Nos bajan si la probabilidad de default pasa de ${pct(th, 1)}; hoy va en ${pct(h.pDefault, 1)}.`;
  } else if (dSpread > 0.015) {
    level = 1;
    say = `El spread subió ${Math.round(dSpread * 10000)} pb en un año. Los prestamistas conservadores se están llenando.`;
  } else {
    say = `El mercado nos presta con holgura: cubriría ${pct(h.cushion, 0)} de lo que necesitamos, aun con una nota menos ${pct(h.cushionDown, 0)}.`;
  }
  return { id: 'credito', icon: '🏦', name: 'Crédito público', level, say, series: ['cushion', 'cushionDown', 'spread', 'pDefault'], refs: [{ v: 100, label: 'Lo que hay que refinanciar (100%)' }] };
}

function bancoCentral(w, h, hist) {
  const level = h.inflation > 0.1 ? 2 : h.inflation > 0.06 || (h.monet ?? 0) > 0.01 ? 1 : 0;
  const say = level === 0
    ? `La inflación está en ${pct(h.inflation)}, cerca de la meta de ${pct(P.inflTargetA, 0)}.`
    : `La inflación va en ${pct(h.inflation)}${(h.monet ?? 0) > 0.002 ? ` y estamos imprimiendo ${pct(h.monet * 4)} del PIB al año para pagar` : ''}. Se come el salario real y alimenta las huelgas.`;
  return { id: 'banco', icon: '🪙', name: 'Banco central', level, say, series: ['inflation', 'monet'], refs: [{ v: P.inflTargetA * 100, label: 'Meta de inflación' }] };
}

function trabajo(w, h) {
  const m = w.macro, g = m.grievance ?? 0, mid = P.strike.mid;
  const level = m.strike > 0 || g > mid ? 2 : g > 0.6 * mid ? 1 : 0;
  const say = m.strike > 0
    ? `Hay ${m.strikeKind}: negociar sube el salario mínimo, aguantar cuesta producción.`
    : level === 0
      ? `Los sindicatos están tranquilos (malestar ${Math.round(g * 100)} de ${Math.round(mid * 100)} para un paro).`
      : `El malestar va en ${Math.round(g * 100)}, ${g > mid ? 'por encima' : 'acercándose'} del umbral de paro (${Math.round(mid * 100)}). Lo empujan la caída del salario real, los recortes y los impuestos nuevos.`;
  return { id: 'trabajo', icon: '✊', name: 'Trabajo', level, say, series: ['grievance', 'u', 'inflation'], refs: [{ v: mid * 100, label: 'Umbral de paro' }] };
}

function seguridad(w, h) {
  const waves = w.regions.filter((r) => r.crime > 1.25 * r.crimeBase).map((r) => r.name);
  const fires = h.fires ?? 0;
  const level = h.crime > 1.25 || waves.length >= 3 ? 2 : h.crime > 1.1 || waves.length || fires >= 2 ? 1 : 0;
  const say = level === 0
    ? `El crimen está en ${Math.round(h.crime * 100)}% del nivel inicial${fires ? ` y hubo ${fires} incendio${fires > 1 ? 's' : ''}` : ''}.`
    : `El crimen va en ${Math.round(h.crime * 100)}% del nivel inicial${waves.length ? `, con olas de robo en ${waves.join(', ')}` : ''}. Sube con el desempleo y la pobreza, no solo cuando falta policía.`;
  return { id: 'seguridad', icon: '🚓', name: 'Seguridad', level, say, series: ['crime', 'u', 'poverty'], refs: [{ v: 125, label: 'Ola de robos (125%)' }] };
}

function salud(w, h) {
  const sick = w.regions.filter((r) => r.sick > 0.01).map((r) => r.name);
  // Atención cuando la red se deteriora frente a como empezó, no por ser débil de entrada.
  const worse = w.regions.filter((r) => r.health < 0.9 * r.health0).map((r) => r.name);
  const weakest = [...w.regions].sort((a, b) => a.health - b.health)[0];
  const level = (h.sick ?? 0) > 0.03 ? 2 : sick.length || worse.length ? 1 : 0;
  const say = sick.length
    ? `Hay brotes en ${sick.join(', ')}: suben los costos de las empresas y la pobreza.`
    : worse.length
      ? `La red de salud se deteriora en ${worse.join(', ')}: ahí las epidemias se vuelven más probables.`
      : `Sin brotes. La red más débil es la de ${weakest.name}: ahí es donde más pegaría una epidemia.`;
  return { id: 'salud', icon: '🏥', name: 'Salud', level, say, series: ['sick', 'poverty'], refs: [] };
}

function empresas(w, h, hist) {
  const gone = delta(hist, 'relocatedTotal'), dInf = delta(hist, 'informality'), dFirms = delta(hist, 'firms');
  const level = gone >= 6 || dInf > 0.03 ? 2 : gone >= 2 || dInf > 0.01 || dFirms < -8 ? 1 : 0;
  const say = level === 0
    ? `Las empresas se quedan: ${h.firms} activas e informalidad de ${pct(h.informality, 0)}.`
    : `${gone > 0 ? `${gone} empresa${gone > 1 ? 's' : ''} se fue${gone > 1 ? 'ron' : ''} al vecino en el último año` : 'Las empresas se achican'}` +
      `${dInf > 0.005 ? ` y la informalidad subió ${pp(dInf)}` : ''}. Cada una que se va se lleva su recaudo.`;
  return { id: 'empresas', icon: '🏭', name: 'Empresas', level, say, series: ['firms', 'relocatedTotal', 'informality'], refs: [] };
}

function politica(w, h, hist) {
  const left = P.electionEvery - (w.t % P.electionEvery), dA = delta(hist, 'approval');
  const streak = w.macro.lowStreak ?? 0;
  const level = h.approval < 0.25 || streak >= 1 ? 2 : (h.approval < 0.4 && left <= 6) || dA < -0.05 ? 1 : 0;
  const say = streak >= 1
    ? `Con ${pct(h.approval, 0)} de aprobación${h.poverty > P.poverty0 + 0.1 ? ` y la pobreza en ${pct(h.poverty, 0)}` : ''}, un trimestre más así y hay estallido social.`
    : level === 0
      ? `Aprobación de ${pct(h.approval, 0)}. Elecciones en ${left} trimestre${left > 1 ? 's' : ''}; necesitas 40%.`
      : `La aprobación ${dA < 0 ? `cayó ${Math.abs(Math.round(dA * 100))} puntos en un año y ` : ''}va en ${pct(h.approval, 0)}. Elecciones en ${left} trimestre${left > 1 ? 's' : ''}: necesitas 40%.`;
  return { id: 'politica', icon: '🗳️', name: 'Política', level, say, series: ['approval', 'poverty', 'u'], refs: [{ v: 40, label: 'Para reelegirte (40%)' }, { v: 25, label: 'Riesgo de estallido (25%)' }] };
}

export function advise(w) {
  const hist = w.hist, h = hist.at(-1);
  return [hacienda, credito, bancoCentral, trabajo, seguridad, salud, empresas, politica].map((f) => f(w, h, hist));
}
