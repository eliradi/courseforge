import type { LucideIcon } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs tracking-wide uppercase">
          {Icon ? <Icon className="size-3.5" /> : null}
          {label}
        </p>
        <p className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</p>
        {hint ? <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
