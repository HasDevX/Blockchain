import { ReactNode } from "react";
import { clsx } from "clsx";

interface StatCardProps {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  hint?: string;
  className?: string;
}

export function StatCard({ label, value, hint, icon, className }: StatCardProps) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-slate-800 bg-surface-light/40 p-4 shadow-subtle",
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-400">{label}</p>
          <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
          {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
        </div>
        {icon ? <div className="text-primary-300">{icon}</div> : null}
      </div>
    </div>
  );
}
