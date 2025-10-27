import { ReactNode } from "react";
import { clsx } from "clsx";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";

const VARIANT_META = {
  info: {
    icon: InformationCircleIcon,
    container: "border-sky-500/40 bg-sky-500/10 text-sky-100",
    iconColor: "text-sky-300",
  },
  success: {
    icon: CheckCircleIcon,
    container: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
    iconColor: "text-emerald-300",
  },
  warning: {
    icon: ExclamationTriangleIcon,
    container: "border-amber-500/40 bg-amber-500/10 text-amber-100",
    iconColor: "text-amber-300",
  },
  error: {
    icon: XCircleIcon,
    container: "border-rose-500/40 bg-rose-500/10 text-rose-100",
    iconColor: "text-rose-300",
  },
} as const;

export type AlertVariant = keyof typeof VARIANT_META;

interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children?: ReactNode;
  className?: string;
}

export function Alert({ variant = "info", title, children, className }: AlertProps) {
  const meta = VARIANT_META[variant];
  const Icon = meta.icon;
  const role = variant === "error" || variant === "warning" ? "alert" : "status";

  return (
    <div
      className={clsx(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-subtle",
        meta.container,
        className,
      )}
      role={role}
      aria-live={variant === "error" ? "assertive" : "polite"}
    >
      <Icon className={clsx("h-5 w-5 shrink-0", meta.iconColor)} aria-hidden="true" />
      <div className="space-y-1">
        {title ? <p className="font-semibold text-inherit">{title}</p> : null}
        {children ? <div className="text-inherit/90">{children}</div> : null}
      </div>
    </div>
  );
}
