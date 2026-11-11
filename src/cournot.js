// Equilibrio de Cournot con costos marginales heterogéneos y demanda lineal P = A - B·Q.
// Las empresas se ordenan por costo y se agregan mientras su costo sea menor que el
// precio del equilibrio sin ellas; las demás producen cero.
export function solveCournot(A, B, costs) {
  const n = costs.length;
  const order = costs.map((_, i) => i).sort((i, j) => costs[i] - costs[j]);
  let sum = 0, active = 0;
  for (let k = 0; k < n; k++) {
    const c = costs[order[k]];
    if (c < (A + sum) / (k + 1)) { sum += c; active = k + 1; } else break;
  }
  if (active === 0) return { P: A, Q: 0, q: new Array(n).fill(0) };
  const P = (A + sum) / (active + 1);
  const q = costs.map((c) => (c < P ? (P - c) / B : 0));
  const Q = q.reduce((a, b) => a + b, 0);
  return { P, Q, q };
}
