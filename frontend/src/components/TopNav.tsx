import { ChangeEvent, FormEvent, ReactNode, useState } from "react";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { clsx } from "clsx";

interface TopNavProps {
  onGlobalSearch?: (value: string) => void;
  actions?: ReactNode;
}

export function TopNav({ onGlobalSearch, actions }: TopNavProps) {
  const [search, setSearch] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!search.trim()) {
      return;
    }

    onGlobalSearch?.(search.trim());
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-xl font-semibold text-slate-100">
            <span className="rounded-lg bg-primary-500/20 px-2 py-1 text-sm uppercase tracking-wider text-primary-200">
              ExplorerToken
            </span>
            <span className="hidden text-sm text-slate-500 md:inline">
              Multi-chain token explorer
            </span>
          </div>
          <form
            onSubmit={handleSubmit}
            className="hidden items-center gap-2 rounded-full border border-slate-800 bg-slate-900/70 px-3 py-1 md:flex"
          >
            <MagnifyingGlassIcon className="h-4 w-4 text-slate-500" />
            <input
              type="search"
              value={search}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
              placeholder="Search address, token or tx hash"
              className="w-64 bg-transparent text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
            />
          </form>
        </div>
        <div className={clsx("flex flex-wrap items-center gap-3", actions ? "" : "hidden md:flex")}>
          {actions}
        </div>
      </div>
      <div className="mx-auto block w-full px-4 pb-4 md:hidden">
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/70 px-3 py-2"
        >
          <MagnifyingGlassIcon className="h-4 w-4 text-slate-500" />
          <input
            type="search"
            value={search}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
            placeholder="Search address, token or tx hash"
            className="w-full bg-transparent text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
          />
        </form>
        {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
