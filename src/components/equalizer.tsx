/** Little animated equalizer bars — the app's "something's cooking" motif. */
export function Equalizer({
  className = "h-5",
  bars = 4,
  still = false,
  barClassName = "bg-brand",
}: {
  className?: string;
  bars?: number;
  still?: boolean;
  barClassName?: string;
}) {
  return (
    <span className={`inline-flex items-end gap-[3px] ${className}`} aria-hidden>
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className={`h-full w-[3px] origin-bottom rounded-full ${barClassName} ${still ? "" : "animate-eq"}`}
          style={{ animationDelay: `${(i * 173) % 700}ms`, transform: still ? `scaleY(${[0.5, 0.9, 0.65, 0.8, 0.4][i % 5]})` : undefined }}
        />
      ))}
    </span>
  );
}
