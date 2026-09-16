import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

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
    default: 'CourseForge — Explore college courses and build practice tests',
    template: '%s · CourseForge',
  },
  description:
    'Browse the course catalog of any top-200 US university, then generate 100 practice questions for every section of a course.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="bg-background text-foreground flex min-h-full flex-col">
        <ThemeProvider>
          <TooltipProvider delay={200}>
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <footer className="no-print text-muted-foreground border-t py-6 text-center text-xs">
              CourseForge scrapes only public catalog pages and stores extracted facts, never
              copyrighted book content.
            </footer>
          </TooltipProvider>
          <Toaster richColors closeButton position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
