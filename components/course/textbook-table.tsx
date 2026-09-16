import { BookMarked, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Textbook, TextbookSource } from '@/lib/supabase/types';

const SOURCE_LABELS: Record<TextbookSource, { label: string; hint: string }> = {
  syllabus: { label: 'syllabus', hint: 'Taken from the course syllabus.' },
  catalog: { label: 'catalog', hint: 'Listed in the course catalog entry.' },
  bookstore: { label: 'bookstore', hint: 'Found on the campus bookstore listing.' },
  ai_inferred: {
    label: 'inferred',
    hint: 'No book was listed anywhere we could reach — this is the text a course like this usually uses. Verify before buying.',
  },
};

export function TextbookTable({ textbooks }: { textbooks: Textbook[] }) {
  if (!textbooks.length) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <BookMarked className="size-4" />
        No required texts were listed for this course.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead className="hidden sm:table-cell">Authors</TableHead>
            <TableHead className="hidden md:table-cell">Edition</TableHead>
            <TableHead className="hidden md:table-cell">ISBN</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {textbooks.map((textbook) => {
            const source = SOURCE_LABELS[textbook.source as TextbookSource] ?? SOURCE_LABELS.catalog;
            const inferred = textbook.source === 'ai_inferred';

            return (
              <TableRow key={textbook.id}>
                <TableCell className="font-medium">{textbook.title}</TableCell>
                <TableCell className="text-muted-foreground hidden text-sm sm:table-cell">
                  {textbook.authors ?? '—'}
                </TableCell>
                <TableCell className="text-muted-foreground hidden text-sm md:table-cell">
                  {textbook.edition ?? '—'}
                </TableCell>
                <TableCell className="text-muted-foreground hidden font-mono text-xs md:table-cell">
                  {textbook.isbn ?? '—'}
                </TableCell>
                <TableCell>
                  <Badge variant={textbook.required ? 'default' : 'secondary'} className="text-[11px]">
                    {textbook.required ? 'Required' : 'Optional'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Badge
                          variant={inferred ? 'outline' : 'secondary'}
                          className={`cursor-help text-[11px] ${
                            inferred ? 'border-amber-500/50 text-amber-700 dark:text-amber-400' : ''
                          }`}
                        />
                      }
                    >
                      {inferred ? <Sparkles className="mr-1 size-3" /> : null}
                      {source.label}
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">{source.hint}</TooltipContent>
                  </Tooltip>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
