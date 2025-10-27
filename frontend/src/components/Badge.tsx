import { PropsWithChildren } from "react";
import { clsx } from "clsx";

type BadgeVariant = "default" | "warning" | "success";

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-slate-800/60 text-slate-200 border border-slate-700/60",
  warning: "bg-amber-500/10 text-amber-300 border border-amber-500/30",
  success: "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30",
};

interface BadgeProps {
  variant?: BadgeVariant;
  className?: string;
}

export function Badge({ children, variant = "default", className }: PropsWithChildren<BadgeProps>) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
