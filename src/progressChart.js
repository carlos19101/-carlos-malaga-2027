// Display scale only: never modifies measurements or calculates a forecast.
export function progressDomain(values, goal) {
  const samples = [...values, goal].filter(value => Number.isFinite(value) && value >= 0);
  if (!samples.length) return { min: 0, max: 1, ticks: [0, 0.5, 1] };
  const low = Math.min(...samples), high = Math.max(...samples);
  const span = Math.max(high - low, 2);
  const step = span <= 12 ? 2 : 10 ** Math.floor(Math.log10(span));
  const min = Math.max(0, Math.floor((low - span * 0.1) / step) * step);
  const max = Math.max(min + step, Math.ceil(high / step) * step);
  return { min, max, ticks: [min, (min + max) / 2, max] };
}
