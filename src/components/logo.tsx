import Link from "next/link";

export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <span className={`inline-grid place-items-center rounded-xl bg-brand shadow-glow ${className}`} aria-hidden>
      <svg viewBox="0 0 24 24" className="h-[60%] w-[60%]" fill="white">
        <rect x="3" y="9" width="3" height="6" rx="1.5" />
        <rect x="8" y="5" width="3" height="14" rx="1.5" />
        <rect x="13" y="7" width="3" height="10" rx="1.5" />
        <rect x="18" y="10" width="3" height="4" rx="1.5" />
      </svg>
    </span>
  );
}

export function Logo({ href = "/catalogue" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 font-display text-lg font-semibold tracking-tight">
      <LogoMark />
      <span>
        Darka&apos;s <span className="text-brand">Studio</span>
      </span>
    </Link>
  );
}
