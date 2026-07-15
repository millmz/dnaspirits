/**
 * Lightweight server-rendered SVG charts in the De Nada palette.
 * No client JS, no chart library — they render inside server components.
 */

type Series = { label: string; color: string; values: number[] };

const monthLabel = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  return m === 1 ? `${name} ’${String(y).slice(2)}` : name;
};

export function BarChart({
  groups,
  series,
  height = 190,
}: {
  groups: string[]; // YYYY-MM period per group
  series: Series[];
  height?: number;
}) {
  const width = 760;
  const pad = { top: 12, right: 8, bottom: 26, left: 8 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...series.flatMap((s) => s.values));

  const groupW = plotW / Math.max(1, groups.length);
  const barW = Math.min(22, (groupW * 0.72) / series.length);
  const labelEvery = groups.length > 9 ? 2 : 1;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={series.map((s) => s.label).join(" vs ")}
      >
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={pad.top + plotH}
          y2={pad.top + plotH}
          stroke="#231F20"
          strokeOpacity="0.25"
        />
        {groups.map((g, gi) => {
          const cx = pad.left + groupW * gi + groupW / 2;
          const totalBars = barW * series.length;
          return (
            <g key={g}>
              {series.map((s, si) => {
                const v = s.values[gi] ?? 0;
                const h = max > 0 ? (v / max) * plotH : 0;
                return (
                  <rect
                    key={s.label}
                    x={cx - totalBars / 2 + si * barW + 1}
                    y={pad.top + plotH - h}
                    width={Math.max(1, barW - 2)}
                    height={Math.max(v > 0 ? 1.5 : 0, h)}
                    rx={1.5}
                    fill={s.color}
                  >
                    <title>{`${g} · ${s.label}: ${Math.round(v).toLocaleString("en-US")}`}</title>
                  </rect>
                );
              })}
              {gi % labelEvery === 0 && (
                <text
                  x={cx}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize="11"
                  fill="#231F20"
                  fillOpacity="0.65"
                >
                  {monthLabel(g)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-4">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-xs text-ink/70">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
