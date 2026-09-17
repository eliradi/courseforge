import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

import { HideOnPaths } from '@/components/layout/hide-on-paths';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { ThemeProvider } from '@/components/layout/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

import './globals.css';

const inter = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Aceversity — Explore college courses and build practice tests',
    template: '%s · Aceversity',
  },
  description:
    'Browse the course catalog of top-ranked worldwide universities, then generate practice questions for every section of a course.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full scroll-smooth antialiased`}
      // Lets Next turn smooth scrolling off during route changes.
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground flex min-h-full flex-col">
        <ThemeProvider>
          <TooltipProvider delay={200}>
            <HideOnPaths paths={['/', '/auth/login']}>
              <SiteHeader />
            </HideOnPaths>
            <main className="flex-1">{children}</main>
            <SiteFooter />
          </TooltipProvider>
          <Toaster richColors closeButton position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
