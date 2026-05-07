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

  const points = values
    .map((v, i) => {
      const x = i * stepX;
      // Invert Y — chart down means bigger Y in SVG.
      const y = span === 0 ? height / 2 : height - 2 - ((v - min) / span) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      aria-hidden
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}
