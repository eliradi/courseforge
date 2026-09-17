'use client';

import { ChevronRight, Search } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';

import { SortableHead, useSortedRows } from '@/components/admin/sortable-head';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatTokens, formatUsd } from '@/lib/ai/pricing';
import type { AdminUserRow } from '@/lib/db/admin-queries';
import { cn } from '@/lib/utils';

type UserSort =
  | 'email'
  | 'joined'
  | 'lastSeen'
  | 'favorites'
  | 'made'
  | 'taken'
  | 'average'
  | 'best'
  | 'calls'
  | 'cost';

const TEXT_COLUMNS: UserSort[] = ['email'];
const descByDefault = (column: UserSort) => !TEXT_COLUMNS.includes(column);

const time = (value: string | null) => (value ? new Date(value).getTime() : null);

const ACCESSORS: Record<UserSort, (user: AdminUserRow) => string | number | null> = {
  email: (u) => u.email,
  joined: (u) => time(u.createdAt),
  lastSeen: (u) => time(u.lastSignInAt),
  favorites: (u) => u.favoriteColleges.length + u.favoriteCourses.length,
  made: (u) => u.testSetsCreated,
  taken: (u) => u.attemptsTaken,
  average: (u) => u.averageScore,
  best: (u) => u.bestScore,
  calls: (u) => u.aiCalls,
  cost: (u) => u.costUsd,
};

const COLUMN_COUNT = 11;

export function UserTable({ users }: { users: AdminUserRow[] }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());

  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(
      (user) =>
        (user.email ?? '').toLowerCase().includes(needle) ||
        user.id.toLowerCase().startsWith(needle) ||
        user.favoriteColleges.some((name) => name.toLowerCase().includes(needle)) ||
        user.favoriteCourses.some((name) => name.toLowerCase().includes(needle)),
    );
  }, [users, query]);

  const { sorted, sort, onSort } = useSortedRows<AdminUserRow, UserSort>(
    matching,
    ACCESSORS,
    { key: 'lastSeen', desc: true },
    descByDefault,
  );

  function toggle(id: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const head = (column: UserSort, label: string, align: 'left' | 'right' = 'right') => (
    <SortableHead label={label} column={column} sort={sort} onSort={onSort} align={align} />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by email, user id or favourite…"
            className="h-9 pl-9"
            aria-label="Search users"
          />
        </div>
        <Badge variant="outline" className="h-7 tabular-nums">
          {query ? `${sorted.length} of ${users.length}` : `${users.length} users`}
        </Badge>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              {head('email', 'User', 'left')}
              {head('joined', 'Joined', 'left')}
              {head('lastSeen', 'Last seen', 'left')}
              {head('favorites', 'Favourites')}
              {head('made', 'Tests made')}
              {head('taken', 'Taken')}
              {head('average', 'Avg score')}
              {head('best', 'Best')}
              {head('calls', 'AI calls')}
              {head('cost', 'AI cost')}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length ? (
              sorted.map((user) => {
                const expanded = open.has(user.id);
                const favourites = user.favoriteColleges.length + user.favoriteCourses.length;
                return (
                  <Fragment key={user.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => toggle(user.id)}
                      aria-expanded={expanded}
                    >
                      <TableCell className="pr-0">
                        <ChevronRight
                          className={cn('text-muted-foreground size-4 transition-transform', expanded && 'rotate-90')}
                        />
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2 text-sm font-medium">
                          {user.email ?? '(no email)'}
                          {user.isAdmin ? (
                            <Badge variant="secondary" className="text-[10px]">
                              admin
                            </Badge>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {user.lastSignInAt ? (
                          new Date(user.lastSignInAt).toLocaleDateString()
                        ) : (
                          <span className="text-muted-foreground">never</span>
                        )}
                      </TableCell>
                      <Num value={favourites} />
                      <Num value={user.testSetsCreated} />
                      <Num value={user.attemptsTaken} />
                      <Num value={user.averageScore} suffix="%" />
                      <Num value={user.bestScore} suffix="%" />
                      <Num value={user.aiCalls} />
                      <TableCell className="text-right text-xs tabular-nums">
                        {user.costUsd > 0 ? (
                          <>
                            <span className="block">{formatUsd(user.costUsd)}</span>
                            <span className="text-muted-foreground block text-[10px]">
                              {formatTokens(user.totalTokens)} tok
                            </span>
                          </>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                    </TableRow>
                    {expanded ? (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell />
                        <TableCell colSpan={COLUMN_COUNT - 1} className="py-4 whitespace-normal">
                          <UserDetails user={user} />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="text-muted-foreground h-24 text-center">
                  No users match “{query}”.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-muted-foreground text-xs">
        Click a user to see their favourites and most recent results. AI calls and cost count the model
        calls attributed to that user.
      </p>
    </div>
  );
}

function Num({ value, suffix = '' }: { value: number | null; suffix?: string }) {
  return (
    <TableCell className="text-right text-xs tabular-nums">
      {value === null || value === 0 ? '—' : `${value}${suffix}`}
    </TableCell>
  );
}

function UserDetails({ user }: { user: AdminUserRow }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">Favourites</p>
        {user.favoriteColleges.length || user.favoriteCourses.length ? (
          <div className="flex flex-wrap gap-1.5">
            {user.favoriteColleges.map((name) => (
              <Badge key={`c-${name}`} variant="outline" className="text-[11px] font-normal">
                ★ {name}
              </Badge>
            ))}
            {user.favoriteCourses.map((name) => (
              <Badge key={`k-${name}`} variant="secondary" className="text-[11px] font-normal">
                ✓ {name}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">No favourites saved.</p>
        )}
        <p className="text-muted-foreground mt-3 font-mono text-[10px]">{user.id}</p>
      </div>

      <div>
        <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">Recent results</p>
        {user.recentResults.length ? (
          <ul className="space-y-1">
            {user.recentResults.map((result) => {
              const pct = result.total ? Math.round(((result.score ?? 0) / result.total) * 100) : 0;
              return (
                <li key={result.attemptId} className="flex flex-wrap items-center gap-x-2 text-xs">
                  <span className="font-mono">{result.courseNumber}</span>
                  <span className="text-muted-foreground min-w-0 flex-1 truncate">{result.sectionTitle}</span>
                  <span className="tabular-nums">
                    {result.score}/{result.total}
                  </span>
                  <Badge
                    variant={pct >= 70 ? 'default' : pct >= 40 ? 'secondary' : 'outline'}
                    className="text-[10px] tabular-nums"
                  >
                    {pct}%
                  </Badge>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground text-xs">No tests taken yet.</p>
        )}
      </div>
    </div>
  );
}
