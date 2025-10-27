import { ReactNode } from "react";
import { clsx } from "clsx";

interface TableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  emptyState?: ReactNode;
}

export function Table<T>({ columns, data, emptyState }: TableProps<T>) {
  if (!data.length && emptyState) {
    return <div className="rounded-xl border border-slate-800 bg-surface-light/40 p-8 text-center text-slate-400">{emptyState}</div>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800/80 bg-surface-light/40">
      <table className="min-w-full divide-y divide-slate-800/70">
        <thead className="bg-slate-900/60">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={clsx("px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400", column.className)}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {data.map((row, index) => (
            <tr key={(columns[0]?.key ?? "row") + index} className="hover:bg-slate-900/40">
              {columns.map((column) => (
                <td key={column.key} className={clsx("px-4 py-3 text-sm text-slate-200", column.className)}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
