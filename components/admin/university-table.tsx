'use client';

import { Download, Layers, Radar, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { ActivityCell } from '@/components/admin/activity-cell';
import { BulkDialog, selectCandidates } from '@/components/admin/bulk-dialog';
import { RetrievalDialog, type RetrievalMode } from '@/components/admin/retrieval-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatTokens, formatUsd } from '@/lib/ai/pricing';
import { catalogProvenance } from '@/lib/catalog-source';
import type { AdminCollegeRow, OperationSnapshot } from '@/lib/db/admin-queries';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'indexed' | 'unindexed';

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
  const staleCount = useMemo(() => selectCandidates(colleges, 30).length, [colleges]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return colleges.filter((college) => {
      if (filter === 'indexed' && college.courseCount === 0) return false;
      if (filter === 'unindexed' && college.courseCount > 0) return false;
      if (!needle) return true;
      return (
        college.name.toLowerCase().includes(needle) ||
        college.domain.toLowerCase().includes(needle) ||
        (college.state ?? '').toLowerCase().includes(needle)
      );
    });
  }, [colleges, query, filter]);

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
            placeholder="Filter by name, domain or state…"
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
              <TableHead className="w-14">Rank</TableHead>
              <TableHead>University</TableHead>
              <TableHead>Retrieval method</TableHead>
              <TableHead className="text-right">Depts</TableHead>
              <TableHead className="text-right">Courses</TableHead>
              <TableHead className="text-right">Tests</TableHead>
              <TableHead className="text-right">Taken</TableHead>
              <TableHead className="text-right">Total AI cost</TableHead>
              <TableHead className="w-[13rem]">Latest activity</TableHead>
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
                  </TableCell>

                  <TableCell>
                    <span className="block text-sm font-medium">{college.name}</span>
                    <span className="text-muted-foreground block text-xs">
                      {college.domain}
                      {college.state ? ` · ${college.state}` : ''}
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
                    {college.departmentCount || '—'}
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
