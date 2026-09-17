'use client';

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';

import { TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export interface SortState<K extends string> {
  key: K;
  desc: boolean;
}

/**
 * A column header that sorts its table. Clicking the active column flips the
 * direction; clicking another starts at that column's natural direction
 * (numbers biggest-first, text A–Z).
 */
export function SortableHead<K extends string>({
  label,
  column,
  sort,
  onSort,
  align = 'left',
  className,
  title,
}: {
  label: React.ReactNode;
  column: K;
  sort: SortState<K>;
  onSort: (column: K) => void;
  align?: 'left' | 'right';
  className?: string;
  title?: string;
}) {
  const active = sort.key === column;
  const Icon = !active ? ChevronsUpDown : sort.desc ? ArrowDown : ArrowUp;

  return (
    <TableHead
      className={cn(align === 'right' && 'text-right', className)}
      aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}
      title={title}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          'hover:text-foreground -mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium',
          align === 'right' && 'flex-row-reverse',
          active ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
        <Icon className={cn('size-3 shrink-0', !active && 'opacity-40')} />
      </button>
    </TableHead>
  );
}

/** Next sort state after clicking `column`. */
export function nextSort<K extends string>(
  current: SortState<K>,
  column: K,
  descByDefault: (column: K) => boolean,
): SortState<K> {
  if (current.key === column) return { key: column, desc: !current.desc };
  return { key: column, desc: descByDefault(column) };
}

type SortValue = string | number | null | undefined;

/**
 * Client-side sorting for small tables. `accessors` maps each column to the
 * value it sorts by; empty values always sink to the bottom.
 */
export function useSortedRows<T, K extends string>(
  rows: T[],
  accessors: Record<K, (row: T) => SortValue>,
  initial: SortState<K>,
  descByDefault: (column: K) => boolean,
) {
  const [sort, setSort] = useState<SortState<K>>(initial);

  const sorted = useMemo(() => {
    const read = accessors[sort.key];
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    return [...rows].sort((a, b) => {
      const x = read(a);
      const y = read(b);
      const xEmpty = x === null || x === undefined || x === '';
      const yEmpty = y === null || y === undefined || y === '';
      if (xEmpty || yEmpty) return xEmpty === yEmpty ? 0 : xEmpty ? 1 : -1;
      const order =
        typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
      return sort.desc ? -order : order;
    });
    // `accessors` is a fresh object each render; the columns it describes don't change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);

  const onSort = (column: K) => setSort((current) => nextSort(current, column, descByDefault));

  return { sorted, sort, onSort };
}
