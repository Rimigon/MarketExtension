interface Props {
  /** Pixel height/width of the iconmark. Wordmark inherits parent font-size. */
  iconSize?: number;
  /** Show only the iconmark (no wordmark). */
  iconOnly?: boolean;
  className?: string;
}

/**
 * Brand mark: charcoal stamp with a descending step-chart and a single signal-
 * red marker on the final step. Mirrors public/icons/icon.svg so the in-app
 * wordmark and the browser-action icon agree.
 */
export function Logo({ iconSize = 18, iconOnly = false, className }: Props) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 128 128"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        <rect width="128" height="128" fill="#121212" />
        <path
          d="M 12 36 L 44 36 L 44 60 L 76 60 L 76 84 L 110 84"
          stroke="#F5F5F0"
          strokeWidth="14"
          fill="none"
          strokeLinejoin="miter"
          strokeLinecap="square"
        />
        <rect x="98" y="72" width="24" height="24" fill="#E63946" />
      </svg>
      {!iconOnly && (
        <span className="font-bold leading-none tracking-tight">
          PriceWatch
        </span>
      )}
    </span>
  );
}
