/**
 * Axis math for the dashboard's charts.
 *
 * The y-axis carries every value that is not directly labeled, so its
 * ticks must land on numbers a person can hold: 0 / 100K / 200K, never
 * thirds of whatever the biggest bar happens to be.
 */

/** The axis top and its tick values: 0 up to a clean step above max. */
export function niceTicks(maxValue: number, target = 4): { max: number; ticks: number[] } {
  if (!(maxValue > 0)) return { max: 1, ticks: [0, 1] };
  const raw = maxValue / target;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = 10 * magnitude;
  for (const m of [1, 2, 5, 10]) {
    if (m * magnitude >= raw) {
      step = m * magnitude;
      break;
    }
  }
  const max = Math.ceil(maxValue / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(Math.round(v));
  return { max: Math.round(max), ticks };
}

/** Cents as a compact axis label: $0, $500, $1.5K, $400K, $1.25M. */
export function moneyTickLabel(cents: number): string {
  const dollars = (Number(cents) || 0) / 100;
  const trim = (s: string) => s.replace(/\.?0+$/, "");
  if (dollars >= 1_000_000) return `$${trim((dollars / 1_000_000).toFixed(2))}M`;
  if (dollars >= 1000) return `$${trim((dollars / 1000).toFixed(1))}K`;
  return `$${Math.round(dollars)}`;
}
