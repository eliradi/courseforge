'use client';

import { Check, Loader2 } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

/** Live step list for a running scrape — "Scraping catalog… 2/3". */
export function ScrapeProgress({ steps, title }: { steps: string[]; title: string }) {
  return (
    <Card>
      <CardContent className="py-6">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium">
          <Loader2 className="text-primary size-4 animate-spin" />
          {title}
          {steps.length > 0 ? (
            <span className="text-muted-foreground font-normal tabular-nums">
              step {steps.length}
            </span>
          ) : null}
        </div>

        <ol className="space-y-2">
          {steps.map((step, index) => {
            const isCurrent = index === steps.length - 1;
            return (
              <li
                key={`${step}-${index}`}
                className={`flex items-start gap-2.5 text-sm ${
                  isCurrent ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                <span className="mt-0.5 shrink-0">
                  {isCurrent ? (
                    <Loader2 className="text-primary size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5 text-emerald-600 dark:text-emerald-500" />
                  )}
                </span>
                {step}
              </li>
            );
          })}
          {steps.length === 0 ? (
            <li className="text-muted-foreground text-sm">Starting…</li>
          ) : null}
        </ol>
      </CardContent>
    </Card>
  );
}
