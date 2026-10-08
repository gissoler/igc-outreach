/**
 * Implementa estadísticas deterministas del benchmark.
 * No interpreta el significado comercial del resultado.
 * Contratos: vectores numéricos y tablas de acuerdo.
 */
import { mulberry32 } from '../agent/conditions.mjs';

function choose(n, k) {
  let result = 1;
  for (let index = 1; index <= k; index++) result = result * (n - k + index) / index;
  return result;
}

/**
 * Calcula la cola binomial unilateral exacta.
 * Puro respecto de red, disco y reloj.
 * @param {number} n Número de observaciones no empatadas.
 * @param {number} wins Número de victorias.
 * @returns {number|null} Probabilidad unilateral o null sin observaciones.
 */
export function signTestOneSided(n, wins) {
  if (!n) return null;
  let probability = 0;
  for (let count = wins; count <= n; count++) probability += choose(n, count) * 0.5 ** n;
  return probability;
}

/**
 * Estima un intervalo percentil reproducible por bootstrap.
 * Puro respecto de red, disco y reloj.
 * @param {number[]} differences Diferencias observadas.
 * @param {{B?:number, seed?:number}} options Cantidad de réplicas y semilla.
 * @returns {[number, number]} Límites percentiles del 95 por ciento.
 */
export function bootstrapCI(differences, { B = 10000, seed = 20261006 } = {}) {
  if (!differences.length) return [0, 0];
  const random = mulberry32(seed);
  const samples = [];
  for (let bootstrap = 0; bootstrap < B; bootstrap++) {
    let sum = 0;
    for (let index = 0; index < differences.length; index++) {
      sum += differences[Math.floor(random() * differences.length)];
    }
    samples.push(sum / differences.length);
  }
  samples.sort((left, right) => left - right);
  return [
    samples[Math.floor(0.025 * B)],
    samples[Math.ceil(0.975 * B) - 1],
  ];
}

/**
 * Calcula kappa de Cohen para una tabla binaria.
 * Puro respecto de red, disco y reloj.
 * @param {number[][]} table Matriz de confusión de dos por dos.
 * @returns {number|null} Kappa o null cuando no hay observaciones.
 */
export function cohenKappa(table) {
  const n = table.flat().reduce((sum, value) => sum + value, 0);
  if (!n) return null;
  const observed = (table[0][0] + table[1][1]) / n;
  const rows = [table[0][0] + table[0][1], table[1][0] + table[1][1]];
  const columns = [table[0][0] + table[1][0], table[0][1] + table[1][1]];
  const expected = (rows[0] * columns[0] + rows[1] * columns[1]) / (n * n);
  return expected === 1 ? 1 : (observed - expected) / (1 - expected);
}

/**
 * Cuenta victorias, empates, derrotas y valores excluidos.
 * Puro respecto de red, disco y reloj.
 * @param {Array<number|null>} differences Diferencias pareadas.
 * @param {number} tieMargin Margen inclusivo considerado empate.
 * @returns {{wins:number, ties:number, losses:number, excluded:number}} Conteos exactos.
 */
export function wtl(differences, tieMargin) {
  let wins = 0;
  let ties = 0;
  let losses = 0;
  let excluded = 0;
  for (const difference of differences) {
    if (difference == null || !Number.isFinite(difference)) {
      excluded++;
      continue;
    }
    if (Math.abs(difference) <= tieMargin) ties++;
    else if (difference > tieMargin) wins++;
    else losses++;
  }
  return { wins, ties, losses, excluded };
}
