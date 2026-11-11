// Parámetros del modelo. Todo lo que es una "creencia" del modelo vive aquí,
// para poder discutirlo y cambiarlo sin tocar el motor (ver docs/MODELO.md).

export const SECTOR_KEYS = ['agro', 'manufactura', 'tecnologia', 'servicios', 'mineria'];
export const TAX_KEYS = ['corpTax', 'vat', 'payrollTax', 'royalty', 'tariff'];
export const SPEND_KEYS = ['transfers', 'infra', 'education', 'security', 'enforcement', 'competition'];

// Regiones de Colombia (estilizadas). pop = participación en la población,
// infra/hc/sec = índices de infraestructura, capital humano y seguridad (Andina = 1),
// res = dotación de recursos naturales, u0 = desempleo del año base.
export const REGIONS = [
  { id: 'caribe',      name: 'Caribe',                   u0: 0.110, pop: 0.22, infra: 0.70, hc: 0.75, sec: 0.60, res: 0.45 },
  { id: 'antioquia',   name: 'Antioquia y Eje Cafetero', u0: 0.090, pop: 0.19, infra: 0.90, hc: 0.95, sec: 0.70, res: 0.35 },
  { id: 'andina',      name: 'Andina (Bogotá)',          u0: 0.095, pop: 0.34, infra: 1.00, hc: 1.00, sec: 0.80, res: 0.15 },
  { id: 'santanderes', name: 'Santanderes',              u0: 0.090, pop: 0.07, infra: 0.80, hc: 0.85, sec: 0.65, res: 0.50 },
  { id: 'pacifico',    name: 'Pacífico',                 u0: 0.130, pop: 0.14, infra: 0.65, hc: 0.75, sec: 0.50, res: 0.25 },
  { id: 'llanos',      name: 'Orinoquía y Amazonía',     u0: 0.120, pop: 0.04, infra: 0.45, hc: 0.65, sec: 0.45, res: 1.00 },
];

// kind: tradable = mercado nacional que compite con importaciones (Cournot),
//       local = mercado regional sin importaciones (Cournot), commodity = tomador de precio.
// lambda = peso del trabajo en el costo, kappa = intensidad de capital,
// va = valor agregado por unidad, entryCost/fixed = en trimestres de ventas típicas,
// mobility = fracción del valor que se pierde al mudarse al vecino,
// import0 = penetración de importaciones del año base (calibra el costo de los importados).
export const SECTORS = {
  agro:        { name: 'Agro',                    color: '#7cb342', kind: 'tradable',  share: 0.10, lambda: 0.55, kappa: 2.0, va: 0.55, n0: 44, regionSens: 0.3, entryRate: 1.0,  entryCost: 1.0, fixed: 0.025, mobility: 0.60, import0: 0.12, nForeign: 3, emax: 0.85 },
  manufactura: { name: 'Manufactura',             color: '#a1887f', kind: 'tradable',  share: 0.17, lambda: 0.45, kappa: 3.0, va: 0.40, n0: 40, regionSens: 1.0, entryRate: 1.0,  entryCost: 1.6, fixed: 0.030, mobility: 0.35, import0: 0.38, nForeign: 6, emax: 0.60 },
  tecnologia:  { name: 'Tecnología',              color: '#42a5f5', kind: 'tradable',  share: 0.06, lambda: 0.60, kappa: 1.5, va: 0.65, n0: 26, regionSens: 1.0, entryRate: 1.0,  entryCost: 0.8, fixed: 0.025, mobility: 0.15, import0: 0.45, nForeign: 4, emax: 0.40 },
  servicios:   { name: 'Comercio y servicios',    color: '#ffb300', kind: 'local',     share: 0.50, lambda: 0.55, kappa: 1.5, va: 0.60, n0: 0,  regionSens: 1.0, entryRate: 0.5,  entryCost: 0.6, fixed: 0.025, mobility: null, emax: 0.85 },
  mineria:     { name: 'Minería e hidrocarburos', color: '#78909c', kind: 'commodity', share: 0.08, lambda: 0.20, kappa: 5.0, va: 0.65, n0: 14, regionSens: 0.5, entryRate: 0.35, entryCost: 4.0, fixed: 0.040, mobility: null, emax: 0.15, unitCost: 0.62 },
};

export const NEIGHBOR = {
  name: 'País vecino estable',
  corpTax: 0.25,      // renta empresarial estable
  riskPremium: 0.02,  // prima sobre la tasa mundial (anual)
  laborCost: 1.30,    // costo laboral total / salario (Colombia formal ≈ 1.44)
  regionFactor: 1.0,
  transport: 0.04,    // costo de exportar de vuelta a Colombia
};

// Tipos de prestamistas. gamma = aversión al riesgo, rec = recuperación esperada si hay default,
// wmax = máximo del capital que ponen en este país, W = capital (fracción del PIB anual),
// mandate = cuánto pueden mantener según la calificación.
export const LENDER_TYPES = {
  local:  { name: 'Pensiones y bancos locales', color: '#5c6bc0', gamma: 6.0, rec: 0.35, wmax: 0.55, W: 0.15, bias: 0.0,
            mandate: { 'A-': 1, BBB: 1, 'BB+': 1, 'BB-': 0.9, B: 0.6, CCC: 0.3, CC: 0.15, D: 0 } },
  global: { name: 'Fondos globales',            color: '#26a69a', gamma: 4.0, rec: 0.40, wmax: 0.30, W: 0.09, bias: 0.0,
            mandate: { 'A-': 1, BBB: 1, 'BB+': 0.8, 'BB-': 0.6, B: 0.35, CCC: 0.1, CC: 0.05, D: 0 } },
  hedge:  { name: 'Hedge funds (alto rendimiento)', color: '#ffa726', gamma: 1.5, rec: 0.40, wmax: 0.60, W: 0.04, bias: -0.3, mandate: null },
  buitre: { name: 'Fondos buitre',              color: '#ef5350', gamma: 0.6, rec: 0.70, wmax: 0.90, W: 0.03, bias: -0.2, mandate: null },
};

export const RATINGS = [
  [0.004, 'A-'], [0.009, 'BBB'], [0.018, 'BB+'], [0.035, 'BB-'], [0.07, 'B'], [0.15, 'CCC'], [1.01, 'CC'],
];

export const DEFAULT_POLICY = {
  corpTax: 0.35, vat: 0.19, payrollTax: 0.09, royalty: 0.08, tariff: 0.08,
  minWage: 0.95, regulation: 0.5, competition: 0.0005,
  transfers: 0.07, infra: 0.025, education: 0.045, security: 0.02, enforcement: 0.003,
  monetization: 0, pledge: false, cac: true, autopilot: true,
};

export const P = {
  // demanda y crecimiento
  demandA: 3.5,          // intercepto de demanda (costo unitario de referencia = 1)
  marketScale: 1000,
  gM: 0.0065,            // crecimiento trimestral del tamaño de mercado (~2.6% anual)
  gLF: 0.0065,           // crecimiento trimestral de la fuerza laboral
  subsistence: 0.5,      // fracción de quienes no consiguen empleo en empresas que se rebusca (informal)
  migration: 0.03,       // velocidad de migración interna hacia regiones con menos desempleo
  incomeElasticity: 0.7, // respuesta de la demanda al ingreso de los hogares
  trendSpeed: 0.08,      // qué tan rápido el ingreso "normal" se ajusta al observado
  consShare: 0.45,       // fracción de las ventas que es consumo final (base del IVA)
  // productividad regional
  phiInfra: 0.08, phiHc: 0.08, phiSec: 0.04,
  // costos
  nonWageCost: 0.35,     // prestaciones (prima, cesantías, salud, pensión) sin contar parafiscales
  lcRef: 1.44,
  rRef: 0.08,
  depAllow: 0.5,         // valor presente de las deducciones por depreciación
  shift: 1.2,            // traslado de utilidades por cada punto de diferencia con el vecino
  regCost: 0.03,
  inf: { s0: 0.05, kEnf: 15, enfRef: 0.003, theta: 0.35 },
  // dinámica de empresas
  firmDeath: 0.008, exitStreak: 3, depletion: 0.012,
  frontierGrowth: 0.001, growthHc: 0.004, growthInfra: 0.002, worldCostGrowth: 0.0017, entrantSigma: 0.10,
  lobby: { decay: 0.04, gain: 0.8, threshold: 0.11 },
  reloc: { hmax: 0.10, threshold: 0.15, width: 0.05 },
  cap: { spreadPass: 0.7, policyVol: 0.4, security: 0.03 },
  // regiones
  infraSpeed: 0.03, hcSpeed: 0.012, secSpeed: 0.08,
  spendRef: { infra: 0.025, education: 0.045, security: 0.02 },
  // fiscal
  inflexibleSpending: 0.055,
  targetRevenue: 0.225,
  targetUnemployment: 0.105,
  initialDebtGDP: 0.55, multiShare: 0.12, fxShare: 0.35, maturityQ: 24,
  rf0: 0.04, inflTargetA: 0.03, worldInflQ: 0.005,
  maxSpread: 0.40,
  // política
  electionEvery: 16,
  poverty0: 0.33,        // pobreza monetaria del año base
  displayGDP: 1600,      // PIB anual inicial en billones de COP (solo para mostrar)
};

// Palancas que ve el jugador (la interfaz se genera a partir de esta lista).
export const LEVERS = [
  { key: 'corpTax', group: 'Impuestos', label: 'Renta de empresas', min: 0, max: 0.7, step: 0.01, unit: 'pct', help: 'Sobre la utilidad de la parte formal de cada empresa.' },
  { key: 'vat', group: 'Impuestos', label: 'IVA', min: 0, max: 0.3, step: 0.01, unit: 'pct', help: 'Encarece el consumo y baja el precio que recibe el productor.' },
  { key: 'payrollTax', group: 'Impuestos', label: 'Parafiscales a la nómina', min: 0, max: 0.3, step: 0.01, unit: 'pct', help: 'Sobre el salario formal. Encarece contratar formalmente.' },
  { key: 'royalty', group: 'Impuestos', label: 'Regalías mineras', min: 0, max: 0.3, step: 0.01, unit: 'pct', help: 'Sobre las ventas de minería e hidrocarburos.' },
  { key: 'tariff', group: 'Comercio y competencia', label: 'Arancel promedio', min: 0, max: 0.6, step: 0.01, unit: 'pct', help: 'Protege a las empresas locales de las importaciones.' },
  { key: 'regulation', group: 'Comercio y competencia', label: 'Trámites y regulación', min: 0, max: 1, step: 0.05, unit: 'idx', help: 'Sube el costo de entrar a un mercado y el costo de operar.' },
  { key: 'competition', group: 'Comercio y competencia', label: 'Autoridad de competencia', min: 0, max: 0.003, step: 0.0001, unit: 'pib', help: 'Frena el cabildeo de los incumbentes por más barreras.' },
  { key: 'minWage', group: 'Trabajo', label: 'Salario mínimo / salario de mercado', min: 0.6, max: 1.3, step: 0.01, unit: 'x', help: 'Si supera el salario de mercado de una región, empuja a la informalidad.' },
  { key: 'transfers', group: 'Gasto (% del PIB)', label: 'Transferencias y subsidios', min: 0, max: 0.15, step: 0.005, unit: 'pib', help: 'Sube ingreso y aprobación, baja la pobreza.' },
  { key: 'infra', group: 'Gasto (% del PIB)', label: 'Infraestructura', min: 0, max: 0.08, step: 0.0025, unit: 'pib', help: 'Baja costos de las empresas, con rezago de años.' },
  { key: 'education', group: 'Gasto (% del PIB)', label: 'Educación', min: 0, max: 0.09, step: 0.0025, unit: 'pib', help: 'Sube el capital humano muy lentamente (más que un periodo de gobierno).' },
  { key: 'security', group: 'Gasto (% del PIB)', label: 'Seguridad y justicia', min: 0, max: 0.05, step: 0.0025, unit: 'pib', help: 'Baja la prima de riesgo de invertir en las regiones.' },
  { key: 'enforcement', group: 'Gasto (% del PIB)', label: 'Fiscalización (DIAN)', min: 0, max: 0.01, step: 0.0005, unit: 'pib', help: 'Encarece la evasión, con rendimientos decrecientes.' },
  { key: 'monetization', group: 'Deuda y dinero', label: 'Emisión para financiar al gobierno', min: 0, max: 0.06, step: 0.0025, unit: 'pib', help: 'Plata sin deuda... pagada con inflación.' },
];

export const TOGGLES = [
  { key: 'pledge', label: 'Pignorar regalías como garantía', help: 'Baja el spread hoy; en un default los acreedores embargan las regalías. Queda amarrado 5 años.' },
  { key: 'cac', label: 'Cláusulas de acción colectiva', help: 'Si el 75% acepta una reestructuración, obliga al resto (incluidos los buitres).' },
  { key: 'autopilot', label: 'Piloto automático en crisis', help: 'Reestructura y negocia con holdouts por ti.' },
];
