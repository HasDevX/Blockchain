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
  isLoading?: boolean;
  loadingState?: ReactNode;
  getRowKey?: (row: T, index: number) => string | number;
}

export function Table<T>({
  columns,
  data,
  emptyState,
  isLoading = false,
  loadingState,
  getRowKey,
}: TableProps<T>) {
  const columnCount = columns.length || 1;
  const showEmpty = !isLoading && !data.length && emptyState;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800/80 bg-surface-light/40">
      <div className="max-h-[28rem] overflow-auto">
        <table className="min-w-full divide-y divide-slate-800/70">
          <thead className="sticky top-0 z-10 bg-slate-900/80 backdrop-blur supports-[backdrop-filter]:backdrop-blur">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={clsx(
                    "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400",
                    column.className,
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {isLoading && !data.length ? (
              <tr>
                <td colSpan={columnCount} className="px-4 py-6 text-center text-sm text-slate-400">
                  {loadingState ?? <span className="inline-flex items-center gap-2">Loading…</span>}
                </td>
              </tr>
            ) : showEmpty ? (
              <tr>
                <td colSpan={columnCount} className="px-4 py-6 text-center text-sm text-slate-400">
                  {emptyState}
                </td>
              </tr>
            ) : (
              data.map((row, index) => {
                const rowKey = getRowKey?.(row, index) ?? `${columns[0]?.key ?? "row"}-${index}`;
                return (
                  <tr key={rowKey} className="hover:bg-slate-900/40">
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={clsx("px-4 py-3 text-sm text-slate-200", column.className)}
                      >
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
