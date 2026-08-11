import type { HTMLAttributes, ReactNode } from "react";

const PADDING = {
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
} as const;

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padding?: keyof typeof PADDING;
  /** Reduce el énfasis del borde/fondo cuando la tarjeta vive dentro de otra tarjeta. */
  interactive?: boolean;
}

/**
 * Superficie base del Design System (DESIGN_SYSTEM.md): glass (blur +
 * transparencia) con una sombra ambiental siempre presente y, si
 * `interactive`, una elevación + glow de acento al hover — reemplaza la
 * clase repetida que antes vivía copiada en cada tarjeta del Dashboard.
 */
export function Card({ children, padding = "md", interactive = false, className = "", ...rest }: CardProps) {
  return (
    <div
      className={`glass rounded-2xl border border-line/80 shadow-[0_20px_50px_-24px_rgba(0,0,0,0.55)] ${PADDING[padding]} ${
        interactive
          ? "transition-all duration-base hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-[0_24px_60px_-20px_rgba(139,92,246,0.35)]"
          : ""
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
