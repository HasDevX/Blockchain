import { clsx } from "clsx";

interface TabOption {
  key: string;
  label: string;
}

interface TabsProps {
  value: string;
  options: TabOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
}

export function Tabs({ value, options, onChange, ariaLabel }: TabsProps) {
  return (
    <div
      className="flex gap-2 rounded-full bg-slate-900/60 p-1"
      role="tablist"
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          role="tab"
          aria-selected={option.key === value}
          tabIndex={option.key === value ? 0 : -1}
          className={clsx(
            "flex-1 rounded-full px-3 py-1 text-sm transition focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400",
            option.key === value
              ? "bg-primary-500/20 text-primary-100 shadow-subtle"
              : "text-slate-400 hover:text-primary-200",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
