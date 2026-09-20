/**
 * A stat card's 12-point trend: a quiet gray line with the latest point
 * marked in the chart accent. Decorative next to the value and delta
 * that carry the number, so it is hidden from screen readers.
 */
export function Sparkline({ values }: { values: number[] }) {
  const w = 74;
  const h = 26;
  const pad = 4;
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return [x, y] as const;
  });
  const end = pts[pts.length - 1];
  return (
    <svg className="dash-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline
        points={pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
        fill="none"
        stroke="var(--dash-spark)"
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Surface ring keeps the end dot legible where it crosses the line. */}
      <circle cx={end[0]} cy={end[1]} r={4} fill="#fff" />
      <circle cx={end[0]} cy={end[1]} r={2.6} fill="var(--dash-chart-blue)" />
    </svg>
  );
}
