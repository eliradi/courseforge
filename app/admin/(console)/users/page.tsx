import { Users } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/layout/empty-state';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatTokens, formatUsd } from '@/lib/ai/pricing';
import { listAdminUsers } from '@/lib/db/admin-queries';

export const metadata: Metadata = { title: 'Admin · Users' };
export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const users = await listAdminUsers();

  if (!users.length) {
    return <EmptyState icon={Users} title="No users yet" description="Nobody has signed up." />;
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">{users.length} registered users</p>

      {users.map((user) => (
        <Card key={user.id}>
          <CardContent className="py-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {user.email ?? '(no email)'}
                  {user.isAdmin ? (
                    <Badge variant="secondary" className="text-[10px]">
                      admin
                    </Badge>
                  ) : null}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Joined {new Date(user.createdAt).toLocaleDateString()}
                  {user.lastSignInAt
                    ? ` · last seen ${new Date(user.lastSignInAt).toLocaleDateString()}`
                    : ' · never signed in'}
                </p>
              </div>

              <div className="flex flex-wrap gap-4 text-xs tabular-nums">
                <Metric label="Tests made" value={String(user.testSetsCreated)} />
                <Metric label="Tests taken" value={String(user.attemptsTaken)} />
                <Metric
                  label="Avg score"
                  value={user.averageScore === null ? '—' : `${user.averageScore}%`}
                />
                <Metric
                  label="Best"
                  value={user.bestScore === null ? '—' : `${user.bestScore}%`}
                />
                <Metric
                  label="AI cost"
                  value={formatUsd(user.costUsd)}
                  hint={`${formatTokens(user.totalTokens)} tok`}
                />
              </div>
            </div>

            {user.favoriteColleges.length || user.favoriteCourses.length ? (
              <div className="mt-4 flex flex-wrap gap-1.5">
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
              <p className="text-muted-foreground mt-4 text-xs">No favourites saved.</p>
            )}

            {user.recentResults.length ? (
              <div className="mt-4">
                <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
                  Recent results
                </p>
                <ul className="space-y-1">
                  {user.recentResults.map((result) => {
                    const pct = result.total
                      ? Math.round(((result.score ?? 0) / result.total) * 100)
                      : 0;
                    return (
                      <li
                        key={result.attemptId}
                        className="flex flex-wrap items-center gap-x-2 text-xs"
                      >
                        <span className="font-mono">{result.courseNumber}</span>
                        <span className="text-muted-foreground min-w-0 flex-1 truncate">
                          {result.sectionTitle}
                        </span>
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
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-[10px] tracking-wide uppercase">{label}</p>
      <p className="font-semibold">{value}</p>
      {hint ? <p className="text-muted-foreground text-[10px]">{hint}</p> : null}
    </div>
  );
}
