import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";

/* Token-styled Markdown renderer (GFM: tables, strikethrough, task lists).
   Used for chat answers and any model-authored prose. Compact spacing, sized
   for the chat panel. */

const components: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0 leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-heading">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-tertiary">{children}</del>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-link underline underline-offset-2 hover:text-navy-500">{children}</a>
  ),
  code: ({ inline, className, children, ...props }: any) =>
    inline ? (
      <code className="rounded-[3px] bg-muted px-1 py-px font-mono text-[0.92em] text-navy-700">{children}</code>
    ) : (
      <code className={cn("block", className)} {...props}>{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-sm border border-border-default bg-page p-2.5 font-mono t-body-xs leading-relaxed text-body">{children}</pre>
  ),
  ul: ({ children }) => <ul className="my-1.5 ml-4 list-disc space-y-0.5 marker:text-tertiary">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 ml-4 list-decimal space-y-0.5 marker:text-tertiary">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => <h3 className="mt-3 mb-1 t-heading-md text-heading first:mt-0">{children}</h3>,
  h2: ({ children }) => <h4 className="mt-3 mb-1 t-heading-sm text-heading first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="mt-2.5 mb-1 t-emphasis-md text-heading first:mt-0">{children}</h5>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 rounded-sm bg-muted px-3 py-1.5 text-secondary">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-border-default" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-sm border border-border-default">
      <table className="w-full border-collapse text-[0.95em]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-border-default last:border-0">{children}</tr>,
  th: ({ children, style }) => <th style={style} className="px-2 py-1.5 text-left t-emphasis-sm text-secondary whitespace-nowrap">{children}</th>,
  td: ({ children, style }) => <td style={style} className="px-2 py-1.5 align-top t-num">{children}</td>,
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("[&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
