'use client';

import { Building2, SearchCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { CollegePicker, type CollegeOption } from '@/components/college/college-picker';
import { CourseFinder } from '@/components/college/course-finder';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Mode = 'browse' | 'check';

const STORAGE_KEY = 'aceversity:home-search-mode';

/**
 * Signed-in home search: browse a university's catalog, or check whether a
 * specific course is in the system (with similar courses elsewhere). The last
 * mode used is remembered on this device.
 */
export function HomeSearch({ colleges }: { colleges: CollegeOption[] }) {
  const [mode, setMode] = useState<Mode>('browse');

  // Read after mount so the server render and first client render agree.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === 'browse' || saved === 'check') setMode(saved);
    } catch {
      // Storage unavailable (private mode, blocked site data) — keep the default.
    }
  }, []);

  function change(value: unknown) {
    if (value !== 'browse' && value !== 'check') return;
    setMode(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Not remembering the choice is fine.
    }
  }

  return (
    <Tabs value={mode} onValueChange={change} className="gap-4">
      <TabsList className="mx-auto h-9 w-full max-w-sm">
        <TabsTrigger value="browse">
          <Building2 />
          Browse universities
        </TabsTrigger>
        <TabsTrigger value="check">
          <SearchCheck />
          Check a course
        </TabsTrigger>
      </TabsList>

      <TabsContent value="browse">
        <CollegePicker colleges={colleges} signedIn />
        <p className="text-muted-foreground mt-3 text-xs">
          Start typing — try &ldquo;MIT&rdquo;, &ldquo;Berkeley&rdquo;, or &ldquo;Texas&rdquo;.
        </p>
      </TabsContent>

      <TabsContent value="check">
        <CourseFinder colleges={colleges} signedIn />
      </TabsContent>
    </Tabs>
  );
}
