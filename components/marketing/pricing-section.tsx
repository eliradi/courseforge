import { Check, Sparkles } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const MONTHLY = 3.99;
const YEARLY = 39.99;
/** What a year costs on the monthly plan versus the yearly one. */
const YEARLY_SAVING = Math.round((1 - YEARLY / (MONTHLY * 12)) * 100);

const FEATURES = [
  'Search courses at the top 250 universities worldwide',
  'Practice tests of 10 to 100 questions for any section',
  'Unlimited retakes and freshly generated tests',
  'Detailed results by topic and difficulty',
  'Progress tracking across every attempt',
  'Saved favourite courses and universities',
];

const PLANS = [
  {
    name: 'Monthly',
    price: `$${MONTHLY}`,
    period: '/month',
    note: 'Billed monthly · cancel anytime',
    featured: false,
  },
  {
    name: 'Yearly',
    price: `$${YEARLY}`,
    period: '/year',
    note: `Just $${(YEARLY / 12).toFixed(2)}/month · billed yearly`,
    badge: `Save ${YEARLY_SAVING}%`,
    featured: true,
  },
];

export function PricingSection({ signedIn }: { signedIn: boolean }) {
  return (
    <section id="pricing" className="mt-24 scroll-mt-8 text-center">
      <p className="text-brand-teal text-sm font-semibold">Pricing</p>
      <h2 className="text-primary mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
        Simple pricing. Everything included.
      </h2>
      <p className="text-muted-foreground mx-auto mt-3 max-w-lg">
        One plan with every feature — pay monthly, or yearly and save {YEARLY_SAVING}%.
      </p>

      <div className="mx-auto mt-10 grid max-w-3xl gap-5 text-left sm:grid-cols-2">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className={cn(
              'relative flex flex-col rounded-3xl border p-6 shadow-sm sm:p-7',
              plan.featured
                ? 'border-primary/40 from-primary/[0.08] to-brand-teal/[0.08] ring-primary/20 bg-gradient-to-br ring-1'
                : 'bg-card',
            )}
          >
            {plan.badge ? (
              <span className="from-primary to-brand-teal absolute -top-3 right-6 flex items-center gap-1 rounded-full bg-gradient-to-r px-3 py-1 text-xs font-semibold text-white shadow-sm">
                <Sparkles className="size-3" />
                {plan.badge}
              </span>
            ) : null}

            <h3 className="text-lg font-semibold">{plan.name}</h3>
            <p className="mt-3 flex items-baseline gap-1">
              <span className="text-4xl font-semibold tracking-tight tabular-nums">
                {plan.price}
              </span>
              <span className="text-muted-foreground">{plan.period}</span>
            </p>
            <p className="text-muted-foreground mt-1 text-sm">{plan.note}</p>

            <ul className="mt-6 flex-1 space-y-2.5 text-sm">
              {FEATURES.map((feature) => (
                <li key={feature} className="flex gap-2">
                  <Check className="text-brand-teal mt-0.5 size-4 shrink-0" />
                  {feature}
                </li>
              ))}
            </ul>

            <Button
              className="mt-7 w-full rounded-full"
              variant={plan.featured ? 'default' : 'outline'}
              nativeButton={false}
              render={<Link href={signedIn ? '/#top' : '/auth/login'} />}
            >
              {signedIn ? 'Keep acing' : 'Start Acing'}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
