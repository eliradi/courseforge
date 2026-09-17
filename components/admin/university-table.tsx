'use client';

import { Download, Layers, Radar, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { ActivityCell } from '@/components/admin/activity-cell';
import { SortableHead, useSortedRows } from '@/components/admin/sortable-head';
import { BulkDialog, selectCandidates } from '@/components/admin/bulk-dialog';
import { RetrievalDialog, type RetrievalMode } from '@/components/admin/retrieval-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatTokens, formatUsd } from '@/lib/ai/pricing';
import { catalogProvenance } from '@/lib/catalog-source';
import { collegeRegion, placeName } from '@/lib/colleges';
import type { AdminCollegeRow, OperationSnapshot } from '@/lib/db/admin-queries';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'indexed' | 'unindexed';

type CollegeSort =
  | 'rank'
  | 'name'
  | 'method'
  | 'depts'
  | 'courses'
  | 'tests'
  | 'taken'
  | 'cost'
  | 'activity';

/** Rank and names read naturally ascending; counts, money and recency biggest-first. */
const ASCENDING: CollegeSort[] = ['rank', 'name', 'method'];
const descByDefault = (column: CollegeSort) => !ASCENDING.includes(column);

function latestActivity(college: AdminCollegeRow): number | null {
  const times = Object.values(college.operations as unknown as Record<string, OperationSnapshot>)
    .map((op) => (op.at ? new Date(op.at).getTime() : 0))
    .filter(Boolean);
  return times.length ? Math.max(...times) : null;
}

const ACCESSORS: Record<CollegeSort, (college: AdminCollegeRow) => string | number | null> = {
  // US News ranks first, then QS World ranks — the two lists share numbers.
  rank: (c) => (c.rank === null ? null : c.rank + (collegeRegion(c) === 'intl' ? 1000 : 0)),
  name: (c) => c.name,
  method: (c) => catalogProvenance(c.platform, c.source)?.label ?? null,
  // Coverage first, so "fully sourced" and "not started" separate cleanly.
  depts: (c) => (c.departmentCount ? c.departmentsSourced / c.departmentCount + c.departmentCount / 1e6 : null),
  courses: (c) => c.courseCount,
  tests: (c) => c.testSetCount,
  taken: (c) => c.attemptsTaken,
  cost: (c) => c.costUsd,
  activity: latestActivity,
};

export function UniversityTable({ colleges }: { colleges: AdminCollegeRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [results, setResults] = useState<Record<string, string>>({});
  const [run, setRun] = useState<{
    mode: RetrievalMode;
    college: AdminCollegeRow;
  } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  // Shown on the bulk button so the size of the job is visible before opening.
  const staleCount = useMemo(
    () => selectCandidates(colleges, 30, 1, 200, true, 'all').length,
    [colleges],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return colleges.filter((college) => {
      if (filter === 'indexed' && college.courseCount === 0) return false;
      if (filter === 'unindexed' && college.courseCount > 0) return false;
      if (!needle) return true;
      return (
        college.name.toLowerCase().includes(needle) ||
        college.domain.toLowerCase().includes(needle) ||
        (placeName(college) ?? '').toLowerCase().includes(needle)
      );
    });
  }, [colleges, query, filter]);

  const { sorted: rows, sort, onSort } = useSortedRows<AdminCollegeRow, CollegeSort>(
    filtered,
    ACCESSORS,
    { key: 'rank', desc: false },
    descByDefault,
  );

  const head = (
    column: CollegeSort,
    label: string,
    align: 'left' | 'right' = 'left',
    extra: { className?: string; title?: string } = {},
  ) => (
    <SortableHead label={label} column={column} sort={sort} onSort={onSort} align={align} {...extra} />
  );

  function launch(mode: RetrievalMode, college: AdminCollegeRow) {
    setRun({ mode, college });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, domain or location…"
            className="h-9 pl-9"
          />
        </div>
        {(['all', 'indexed', 'unindexed'] as Filter[]).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={filter === value ? 'secondary' : 'ghost'}
            onClick={() => setFilter(value)}
            className="capitalize"
          >
            {value}
          </Button>
        ))}
        <Badge variant="outline" className="h-7 tabular-nums">
          {rows.length}
        </Badge>

        <Button size="sm" onClick={() => setBulkOpen(true)}>
          <Layers className="size-3.5" />
          Bulk check &amp; retrieve
          {staleCount ? (
            <Badge variant="secondary" className="ml-1 tabular-nums">
              {staleCount}
            </Badge>
          ) : null}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              {head('rank', 'Rank', 'left', { className: 'w-16' })}
              {head('name', 'University')}
              {head('method', 'Retrieval method')}
              {head('depts', 'Depts', 'right', {
                title: 'Departments sourced / all departments — sorts by share sourced',
              })}
              {head('courses', 'Courses', 'right')}
              {head('tests', 'Tests', 'right')}
              {head('taken', 'Taken', 'right')}
              {head('cost', 'Total AI cost', 'right')}
              {head('activity', 'Latest activity', 'left', { className: 'w-[13rem]' })}
              <TableHead className="w-[15rem]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((college) => {
              const provenance = catalogProvenance(college.platform, college.source);

              return (
                <TableRow key={college.id} className={cn(college.courseCount > 0 && 'bg-primary/[0.03]')}>
                  <TableCell className="text-muted-foreground font-mono text-xs tabular-nums">
                    {college.rank ?? '—'}
                    {collegeRegion(college) === 'intl' ? (
                      <span className="block text-[10px]" title={college.rankSource}>
                        QS
                      </span>
                    ) : null}
                  </TableCell>

                  <TableCell>
                    <span className="block text-sm font-medium">{college.name}</span>
                    <span className="text-muted-foreground block text-xs">
                      {college.domain}
                      {placeName(college) ? ` · ${placeName(college)}` : ''}
                    </span>
                  </TableCell>

                  <TableCell>
                    {provenance ? (
                      <span className="flex items-center gap-1.5 text-xs">
                        <provenance.icon className="size-3.5" />
                        {provenance.label}
                        {college.source ? (
                          <span className="text-muted-foreground">via {college.source}</span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">not discovered</span>
                    )}
                    {college.catalogError ? (
                      <span className="text-destructive block text-[11px]">
                        {college.catalogError}
                      </span>
                    ) : null}
                  </TableCell>

                  <TableCell className="text-right text-xs tabular-nums">
                    {college.departmentCount ? (
                      <span
                        title={
                          `${college.departmentsSourced} of ${college.departmentCount} departments sourced` +
                          ` · ${college.departmentsWithCourses} have courses` +
                          (college.departmentsSourced > college.departmentsWithCourses
                            ? ` · ${college.departmentsSourced - college.departmentsWithCourses} list no current courses`
                            : '')
                        }
                        className={cn(
                          'cursor-help',
                          college.departmentsSourced < college.departmentCount &&
                            'text-amber-700 dark:text-amber-400',
                        )}
                      >
                        {college.departmentsSourced}/{college.departmentCount}
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {college.courseCount.toLocaleString() || '—'}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {college.testSetCount || '—'}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {college.attemptsTaken || '—'}
                  </TableCell>

                  <TableCell className="text-right text-xs tabular-nums">
                    {college.costUsd > 0 ? (
                      <>
                        <span className="block">{formatUsd(college.costUsd)}</span>
                        <span className="text-muted-foreground block text-[10px]">
                          {formatTokens(college.totalTokens)} tok
                        </span>
                      </>
                    ) : (
                      '—'
                    )}
                  </TableCell>

                  <TableCell>
                    <ActivityCell
                      operations={college.operations as unknown as Record<string, OperationSnapshot>}
                    />
                  </TableCell>

                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => launch('probe', college)}
                      >
                        <Radar className="size-3" />
                        Check method
                      </Button>

                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => launch('retrieve', college)}
                      >
                        <Download className="size-3" />
                        Retrieve
                      </Button>
                    </div>

                    {results[college.id] ? (
                      <p className="text-muted-foreground mt-1 text-[11px]">{results[college.id]}</p>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <BulkDialog
        open={bulkOpen}
        onOpenChange={(open) => {
          setBulkOpen(open);
          if (!open) router.refresh();
        }}
        colleges={colleges}
      />

      {run ? (
        <RetrievalDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setRun(null);
              // Counts and costs in the table move as a result of the run.
              router.refresh();
            }
          }}
          mode={run.mode}
          collegeId={run.college.id}
          collegeName={run.college.name}
          onFinished={(summary) => {
            setResults((prev) => ({ ...prev, [run.college.id]: summary }));
            toast.success(`${run.college.name}: ${summary}`);
          }}
        />
      ) : null}

      <p className="text-muted-foreground text-xs">
        <strong>Check method</strong> re-runs catalog discovery only — it reports which platform and
        route we&apos;d use, and what that probe cost. <strong>Retrieve</strong> scrapes departments
        plus the first three departments&apos; course lists, then reports the AI cost of the run
        (adapter-backed catalogs are usually $0.00 — only the generic path spends tokens).
      </p>
    </div>
  );
}
