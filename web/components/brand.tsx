// =============================================================================
// SAGITTAIRE — reusable brand primitives (design-system FOUNDATION).
// Pure presentation. No backend/contract logic. The per-screen restyle agent
// should prefer these over ad-hoc markup. All visual tokens live in globals.css.
// =============================================================================
import type { ReactNode, ButtonHTMLAttributes } from "react";
import Image from "next/image";

/**
 * BrandHeader — the top-bar: centaur mark (cream) on the red paper + the
 * "Sagittaire" wordmark + tagline. `actions` renders right-aligned (wallet,
 * network pill, auditor toggle, etc.).
 */
export function BrandHeader({ actions }: { actions?: ReactNode }) {
  return (
    <header className="sg-header">
      <Image
        className="sg-header__mark"
        src="/brand/mark-cream.png"
        alt="Sagittaire — the centaur archer"
        width={54}
        height={54}
        priority
      />
      <div className="sg-header__text">
        <span className="sg-header__wordmark">Sagittaire</span>
      </div>
      <div className="sg-header__spacer" />
      {actions && <div className="sg-header__actions">{actions}</div>}
    </header>
  );
}

/** Card — parchment surface with letterpress emboss. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`sg-card ${className}`.trim()}>{children}</div>;
}

type ButtonVariant = "default" | "primary" | "ghost" | "danger";

/** Button — brand button; `variant` maps to the legacy button classes. */
export function Button({
  variant = "default",
  className = "",
  children,
  ...rest
}: { variant?: ButtonVariant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = variant === "default" ? "" : variant;
  return (
    <button className={`${cls} ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}

/**
 * HeroNumber — the large classical-serif value, antique gold by default.
 * Use `tone="brand"` to render it in brick red instead (e.g. a revealed figure).
 */
export function HeroNumber({
  children,
  tone = "gold",
}: {
  children: ReactNode;
  tone?: "gold" | "brand";
}) {
  return (
    <div className="sg-hero-number" style={tone === "brand" ? { color: "var(--red-brand)" } : undefined}>
      {children}
    </div>
  );
}
