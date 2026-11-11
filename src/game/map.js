// Mapa de baldosas de una Colombia estilizada. Cada letra es una región del modelo;
// '~' es mar, '.' es tierra extranjera sin jugar y 'v' es el país vecino estable.
const MASK = [
  '~~~~~~~~~~~ccccc~~~~~~~~~~',
  '~~~~~~~~~cccccccc~~~~~~~..',
  '~~~~~~~~cccccccccc~~~.....',
  '~~~~~~~ccccccccccccs......',
  '~~~~~~~cccccccccccsss.....',
  '~~~~~~~aacccccccssss......',
  '~~~~~~paaaaaccccsssss.....',
  '~~~~~~paaaaaaacsssssll....',
  '~~~~~ppaaaaaaasssssllll...',
  '~~~~~ppaaaaaabbbbslllllll.',
  '~~~~~ppaaaaabbbbbbllllllll',
  '~~~~~pppaaabbbbbbbllllllll',
  '~~~~~pppaabbbbbbbblllllll.',
  '~~~~~ppppbbbbbbbbllllllll.',
  '~~~~pppppbbbbbbbllllllll..',
  '~~~~ppppbbbbbbbllllllllll.',
  '~~~~pppppbbbbblllllllllll.',
  '~~~~ppppppbbblllllllllll..',
  '~~~vvpppppblllllllllll....',
  '~~vvvvpppplllllllllll.....',
  '~~vvvvvvvllllllllllll.....',
  '~~vvvvvvvvlllllllllll.....',
  '~~~vvvvvvv...lllllll......',
  '~~~vvvvvvv.....llll.......',
  '~~~~vvvvv.................',
  '~~~~~vvv..................',
];

export const CODE_TO_REGION = { c: 'caribe', a: 'antioquia', b: 'andina', s: 'santanderes', p: 'pacifico', l: 'llanos', v: 'vecino' };

// Capitales (donde se agrupan los servicios y aparecen las protestas).
const CAPITALS = { caribe: [4, 12], antioquia: [9, 9], andina: [12, 13], santanderes: [7, 17], pacifico: [14, 6], llanos: [14, 19], vecino: [21, 6] };

// Ruido determinista para que el mapa sea igual en cada partida.
export function hash(a, b = 0, c = 0) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function buildMap() {
  const rows = MASK.length, cols = MASK[0].length;
  const tiles = [];
  const byRegion = {};
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const ch = MASK[j][i];
      const region = CODE_TO_REGION[ch] ?? null;
      const t = { i, j, ch, region, water: ch === '~', foreign: ch === '.', h: 0, idx: tiles.length };
      // Los Andes: relieve en las regiones de montaña.
      if (region === 'andina' || region === 'antioquia' || region === 'santanderes') t.h = hash(i, j) < 0.55 ? 2 : 1;
      if (region === 'pacifico' && hash(i, j, 3) < 0.25) t.h = 1;
      if (region === 'vecino' && hash(i, j, 5) < 0.3) t.h = 1;
      tiles.push(t);
      if (region) (byRegion[region] ||= []).push(t);
    }
  }
  // Orden de ocupación: primero las baldosas cercanas a la capital (las ciudades crecen desde el centro).
  for (const [reg, list] of Object.entries(byRegion)) {
    const [cj, ci] = CAPITALS[reg];
    for (const t of list) t.dist = Math.hypot(t.i - ci, t.j - cj) + 1.5 * hash(t.i, t.j, 7);
    list.sort((a, b) => a.dist - b.dist);
  }
  const capitals = {};
  for (const [reg, [cj, ci]] of Object.entries(CAPITALS)) capitals[reg] = tiles[cj * cols + ci];
  return { rows, cols, tiles, byRegion, capitals, at: (i, j) => (i >= 0 && j >= 0 && i < cols && j < rows ? tiles[j * cols + i] : null) };
}
