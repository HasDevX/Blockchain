import { clsx } from "clsx";
import { ButtonHTMLAttributes, PropsWithChildren } from "react";

interface PillButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export function PillButton({
  active = false,
  disabled,
  className,
  children,
  ...rest
}: PropsWithChildren<PillButtonProps>) {
  return (
    <button
      type="button"
      className={clsx(
        "rounded-full border px-3 py-1 text-sm transition-colors",
        active
          ? "border-primary-400 bg-primary-500/10 text-primary-200"
          : "border-slate-700 bg-slate-800/60 text-slate-300 hover:border-primary-500 hover:text-primary-300",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
}
