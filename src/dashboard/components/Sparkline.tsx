interface Props {
  values: number[];
  width?: number;
  height?: number;
  /** Direction tone: 'good' = green (drop), 'bad' = red (rise), 'neutral' = slate. */
  tone?: 'good' | 'bad' | 'neutral';
  className?: string;
}

/**
 * Tiny zero-dep sparkline. Stretches `values` to the box, draws a polyline.
 * For empty/short series, renders a flat baseline so the layout doesn't jump.
 */
export function Sparkline({ values, width = 80, height = 24, tone = 'neutral', className }: Props) {
  const stroke =
    tone === 'good' ? 'var(--color-success-500, #059669)' : tone === 'bad' ? 'var(--color-danger-500, #dc2626)' : '#94a3b8';

  if (values.length < 2) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className={className}
        aria-hidden
      >
        <line
          x1={0}
          x2={width}
          y1={height / 2}
          y2={height / 2}
          stroke={stroke}
          strokeOpacity={0.4}
          strokeWidth={1}
        />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const stepX = values.length === 1 ? 0 : width / (values.length - 1);

  // Build a step path: each price holds its level until the next sample,
  // matching the discrete-jumps nature of marketplace prices and the
  // receipt-aesthetic chart language used in PriceChart.
  const yAt = (v: number) =>
    span === 0 ? height / 2 : height - 2 - ((v - min) / span) * (height - 4);

  let d = '';
  values.forEach((v, i) => {
    const x = i * stepX;
    const y = yAt(v);
    if (i === 0) {
      d = `M ${x.toFixed(1)} ${y.toFixed(1)}`;
    } else {
      // Horizontal hold to current x at previous y, then vertical jump.
      d += ` H ${x.toFixed(1)} V ${y.toFixed(1)}`;
    }
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      aria-hidden
    >
      <path
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        strokeLinecap="square"
        strokeLinejoin="miter"
        d={d}
      />
    </svg>
  );
}
