import { cn } from '@/lib/utils';

/**
 * Shell for the company and legal pages: a title block over a readable column.
 * `Prose` styles plain headings, paragraphs and lists, since the project has no
 * typography plugin.
 */
export function ContentPage({
  eyebrow,
  title,
  intro,
  children,
  className,
}: {
  eyebrow?: string;
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mx-auto w-full max-w-3xl px-4 py-14 sm:py-20', className)}>
      <header className="mb-10">
        {eyebrow ? <p className="text-brand-teal mb-2 text-sm font-semibold">{eyebrow}</p> : null}
        <h1 className="text-primary text-3xl font-semibold sm:text-4xl">{title}</h1>
        {intro ? <div className="text-muted-foreground mt-4 text-lg">{intro}</div> : null}
      </header>
      {children}
    </div>
  );
}

export function Prose({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'space-y-4 leading-7',
        '[&_h2]:text-primary [&_h2]:mt-10 [&_h2]:scroll-mt-20 [&_h2]:text-xl [&_h2]:font-semibold',
        '[&_h3]:mt-6 [&_h3]:font-semibold',
        '[&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-6',
        '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4',
        '[&_strong]:font-semibold',
        className,
      )}
    >
      {children}
    </div>
  );
}
