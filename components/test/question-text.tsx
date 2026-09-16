import { Fragment } from 'react';

import { cn } from '@/lib/utils';

/**
 * Renders a question stem.
 *
 * CS courses generate a lot of questions containing code, and the model writes
 * those as markdown fences. Rendering the raw string would show the backticks
 * and collapse the indentation, so fenced blocks become real <pre> blocks and
 * inline `code` spans are styled — everything else stays plain text with its
 * line breaks preserved.
 */
export function QuestionText({ text, className }: { text: string; className?: string }) {
  const segments = text.split(/```(?:[a-zA-Z0-9_-]*)\n?/);

  return (
    <div className={cn('space-y-2.5', className)}>
      {segments.map((segment, index) => {
        // Odd indices sit between fence markers, so they are the code blocks.
        const isCode = index % 2 === 1;
        if (!segment.trim()) return null;

        if (isCode) {
          return (
            <pre
              key={index}
              className="bg-muted overflow-x-auto rounded-lg p-3 font-mono text-[13px] leading-relaxed"
            >
              <code>{segment.replace(/\n+$/, '')}</code>
            </pre>
          );
        }

        return (
          <p key={index} className="leading-relaxed whitespace-pre-wrap">
            {renderInlineCode(segment.trim())}
          </p>
        );
      })}
    </div>
  );
}

function renderInlineCode(text: string) {
  const parts = text.split(/`([^`]+)`/g);
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <code key={index} className="bg-muted rounded px-1 py-0.5 font-mono text-[0.9em]">
        {part}
      </code>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
