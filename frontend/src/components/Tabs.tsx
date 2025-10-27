import { clsx } from "clsx";

interface TabOption {
  key: string;
  label: string;
}

interface TabsProps {
  value: string;
  options: TabOption[];
  onChange: (value: string) => void;
}

export function Tabs({ value, options, onChange }: TabsProps) {
  return (
    <div className="flex gap-2 rounded-full bg-slate-900/60 p-1">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          className={clsx(
            "flex-1 rounded-full px-3 py-1 text-sm transition",
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
