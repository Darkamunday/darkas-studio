"use client";

import { memo, useRef, type ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useI18n } from "@/lib/i18n/client";
import { CopyAction } from "./copy-action";

// Raw HTML in replies is never rendered (react-markdown escapes it); images show as links so a
// reply can't make the browser fetch arbitrary URLs.

// react-markdown passes its syntax-tree `node` to every component; it mustn't reach the DOM.
type WithNode<T extends keyof React.JSX.IntrinsicElements> = ComponentProps<T> & { node?: unknown };

function CodeBlock({ children, node, ...props }: WithNode<"pre">) {
  void node;
  const { m } = useI18n();
  const ref = useRef<HTMLPreElement>(null);
  // rehype-highlight leaves the language on the inner <code> as "language-xyz".
  const child = Array.isArray(children) ? children[0] : children;
  const className = (child as { props?: { className?: string } } | undefined)?.props?.className ?? "";
  const lang = /language-([\w+#.-]+)/.exec(className)?.[1];

  return (
    <div className="chat-code">
      <div className="flex items-center justify-between border-b border-line bg-surface-2 py-1 pl-4 pr-1.5 text-xs text-subtle">
        <span className="font-mono">{lang ?? m.chat.code}</span>
        <CopyAction getText={() => ref.current?.innerText ?? ""} label={m.chat.copyCode} withText />
      </div>
      <pre ref={ref} {...props}>
        {children}
      </pre>
    </div>
  );
}

const components: Components = {
  pre: CodeBlock,
  a: ({ node, ...props }: WithNode<"a">) => {
    void node;
    return <a {...props} target="_blank" rel="noopener noreferrer nofollow" />;
  },
  img: ({ src, alt }) =>
    typeof src === "string" && src ? (
      <a href={src} target="_blank" rel="noopener noreferrer nofollow">
        {alt || src}
      </a>
    ) : null,
};

/** A reply rendered as Markdown. Memoised so finished messages don't re-parse while another streams. */
export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="chat-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false }]]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
