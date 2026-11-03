// ── Rendered markdown (GFM) ──────────────────────────────────────────────────
//
// Split into its own module purely for bundling: react-markdown drags in the whole
// micromark/mdast/remark graph (~250 kB unminified), which used to sit in the main
// chunk and be parsed before anything could paint. ChatView now lazy()s this and
// starts the fetch immediately, so it downloads alongside the shell rather than
// blocking it, and a message list that hasn't rendered yet never pays for it.
//
// Headings, lists, tables, links, inline + fenced code. react-markdown does not
// render raw HTML by default, so this stays injection-safe.
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// memo'd: re-parsing markdown is the heaviest per-render cost, so a finished bubble
// (stable text) skips it entirely - only the still-streaming message re-parses.
const MdText = memo(function MdText({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...p }) => <a {...p} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2 hover:text-accent2" />,
          // Remote images are shown as links, not fetched: a model reply (or injected
          // content it repeats) must not be able to make the browser call out to an
          // arbitrary host with no click. Same-origin images (uploads, project files) render.
          img: ({ node, src, alt, ...p }) => {
            const s = String(src || "");
            const local = s.startsWith("/") && !s.startsWith("//");
            return local
              ? <img {...p} src={s} alt={alt || ""} loading="lazy" className="max-w-full rounded-lg my-2" />
              : <a href={s} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">{alt || s}</a>;
          },
          ul: ({ node, ...p }) => <ul {...p} className="list-disc pl-5 my-2 flex flex-col gap-1" />,
          ol: ({ node, ...p }) => <ol {...p} className="list-decimal pl-5 my-2 flex flex-col gap-1" />,
          h1: ({ node, ...p }) => <h1 {...p} className="text-[17px] font-semibold tracking-[-0.01em] mt-4 mb-1.5" />,
          h2: ({ node, ...p }) => <h2 {...p} className="text-[16px] font-semibold tracking-[-0.01em] mt-3.5 mb-1.5" />,
          h3: ({ node, ...p }) => <h3 {...p} className="text-[14px] font-semibold mt-3 mb-1" />,
          p: ({ node, ...p }) => <p {...p} className="my-1.5 first:mt-0 last:mb-0 leading-relaxed" />,
          blockquote: ({ node, ...p }) => <blockquote {...p} className="border-l-2 border-border pl-3 my-2 text-muted" />,
          // Rules and alignment, not a boxed grid: one strong rule under the header, faint
          // rules between rows, no vertical lines.
          table: ({ node, ...p }) => <div className="my-2.5 overflow-x-auto"><table {...p} className="border-collapse text-[13px] tabular-nums" /></div>,
          th: ({ node, ...p }) => <th {...p} className="border-b border-border px-2.5 py-1.5 text-left text-[12px] font-medium text-muted first:pl-0" />,
          td: ({ node, ...p }) => <td {...p} className="border-b border-border/50 px-2.5 py-1.5 align-top first:pl-0" />,
          code: ({ node, className, children, ...p }) => {
            const inline = !String(className || "").includes("language-");
            return inline
              ? <code {...p} className="px-1 py-px rounded-xs bg-panel2 text-[12.5px] font-mono">{children}</code>
              : <code {...p} className={cn(className, "font-mono")}>{children}</code>;
          },
          pre: ({ node, ...p }) => <pre {...p} className="my-2.5 px-3 py-2.5 rounded-xl bg-panel border border-border overflow-x-auto text-[12.5px] leading-relaxed" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

export default MdText;
