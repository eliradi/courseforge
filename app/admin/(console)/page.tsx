import { BookOpen, Coins, FileQuestion, ListChecks, University, Users } from 'lucide-react';
import type { Metadata } from 'next';

import { StatTile } from '@/components/admin/stat-tile';
import { getAdminTotals } from '@/lib/db/admin-queries';
import { formatTokens, formatUsd } from '@/lib/ai/pricing';

export const metadata: Metadata = { title: 'Admin overview' };
export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  const totals = await getAdminTotals();

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Users" value={String(totals.users)} icon={Users} />
        <StatTile
          label="Universities"
          value={`${totals.indexedColleges} / ${totals.colleges}`}
          hint="indexed / seeded"
          icon={University}
        />
        <StatTile label="Courses cached" value={totals.courses.toLocaleString()} icon={BookOpen} />
        <StatTile
          label="AI spend"
          value={formatUsd(totals.costUsd)}
          hint={`${formatTokens(totals.totalTokens)} tokens · ${totals.aiCalls} calls`}
          icon={Coins}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile label="Test sets" value={String(totals.testSets)} icon={ListChecks} />
        <StatTile
          label="Questions generated"
          value={totals.questions.toLocaleString()}
          icon={FileQuestion}
        />
        <StatTile label="Attempts started" value={String(totals.attempts)} icon={ListChecks} />
      </div>

      <p className="text-muted-foreground text-xs">
        Costs are computed per call from the rate card in <code>lib/ai/pricing.ts</code> and stored
        with the rates in effect at the time, so historical figures stay correct when pricing
        changes.
      </p>
    </div>
  );
}
