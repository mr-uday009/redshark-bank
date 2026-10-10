/**
 * Payment success animation: a ring that draws itself, then a tick, then the
 * caption rises in. Pure CSS keyframes (see globals.css), so there is no
 * animation library and no client-side JS beyond rendering.
 */
export function SuccessCheck({
  title = "Payment sent",
  subtitle,
}: {
  title?: string;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col items-center py-2 text-center">
      <div className="rs-success-pop">
        <svg
          width="72"
          height="72"
          viewBox="0 0 56 56"
          fill="none"
          role="img"
          aria-label="Payment successful"
        >
          <circle
            className="rs-success-ring"
            cx="28"
            cy="28"
            r="24"
            stroke="#059669"
            strokeWidth="2.5"
            strokeLinecap="round"
            transform="rotate(-90 28 28)"
          />
          <path
            className="rs-success-tick"
            d="M17 28.5L24.5 36L39 21"
            stroke="#059669"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <p className="rs-rise mt-4 text-base font-medium">{title}</p>
      {subtitle && (
        <p className="rs-rise mt-1 text-sm text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}
