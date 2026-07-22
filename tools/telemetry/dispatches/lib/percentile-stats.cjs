'use strict';

/**
 * percentile-stats.cjs — Basic stats over numeric arrays.
 */

function calculateStats(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { mean: 0, p50: 0, p95: 0, count: 0 };
  }

  const sorted = values.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const count = sorted.length;

  const getPercentile = (p) => {
    const idx = Math.ceil((p / 100) * count) - 1;
    return sorted[idx];
  };

  return {
    mean: Math.round(sum / count),
    p50: getPercentile(50),
    p95: getPercentile(95),
    count
  };
}

module.exports = { calculateStats };
