import Image from 'next/image';
import Link from 'next/link';

import { cn } from '@/lib/utils';

/**
 * The full Aceversity wordmark, linking home. Both files are transparent; the
 * dark-mode one has its navy lettering lightened so it stays readable.
 */
export function BrandLogo({
  className,
  imageClassName,
  alt = 'Aceversity',
  priority = false,
}: {
  className?: string;
  /** Sets the logo height, e.g. `h-11`. */
  imageClassName: string;
  alt?: string;
  priority?: boolean;
}) {
  const shared = { width: 1732, height: 444, priority };
  return (
    <Link href="/" aria-label="Aceversity home" className={cn('block w-fit', className)}>
      <Image
        {...shared}
        src="/logo-wordmark.png"
        alt={alt}
        className={cn('w-auto dark:hidden', imageClassName)}
      />
      <Image
        {...shared}
        src="/logo-wordmark-dark.png"
        alt={alt}
        className={cn('hidden w-auto dark:block', imageClassName)}
      />
    </Link>
  );
}
