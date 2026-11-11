// Generador pseudoaleatorio con semilla (mulberry32) para que cada partida sea reproducible.
export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  const next = () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  const normal = () => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u = 0;
    while (u === 0) u = next();
    const v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  const poisson = (lam) => {
    if (lam <= 0) return 0;
    if (lam > 30) return Math.max(0, Math.round(lam + Math.sqrt(lam) * normal()));
    const L = Math.exp(-lam);
    let k = 0, p = 1;
    do { k++; p *= next(); } while (p > L);
    return k - 1;
  };
  const pick = (weights) => {
    const total = weights.reduce((a, b) => a + b, 0);
    let x = next() * total;
    for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x <= 0) return i; }
    return weights.length - 1;
  };
  return { next, normal, poisson, pick };
}
