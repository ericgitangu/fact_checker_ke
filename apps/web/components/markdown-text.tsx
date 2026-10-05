import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Safe markdown rendering for AI-generated check/assessment text (the
 * verdict `summary`, the `whatWouldChangeThis` falsifiability note, and a
 * feed row's claim text) — these fields come out of the LLM pipeline and
 * may contain `**bold**`, lists, etc. (services/pipeline), which used to
 * render as raw markdown syntax to the reader.
 *
 * `react-markdown` parses markdown into React elements directly — no
 * `rehype-raw`, no `dangerouslySetInnerHTML` — so raw HTML in the source
 * text is never injected as HTML; it renders as literal escaped text.
 * `remark-gfm` adds the GitHub-flavoured bits (tables, strikethrough,
 * autolinks) the pipeline's prompt may produce.
 *
 * `inline`: for a host element that cannot itself contain block content
 * (e.g. this sits inside an `<h1>`/`<p>`) — every block-level markdown
 * construct (paragraph, list, heading, blockquote) collapses to an inline
 * fragment so the output never nests a `<div>`/`<ul>`/`<p>` inside the
 * host's own block tag. Plain, markdown-free text renders byte-identical
 * to before (a single paragraph node unwrapped to its bare text).
 */
const LINK_COMPONENT: Components["a"] = (props) => {
  const { node, ...rest } = props;
  void node; // react-markdown passes its own AST `node` prop; not a valid DOM attribute
  return <a {...rest} target="_blank" rel="noopener noreferrer" />;
};

const BLOCK_COMPONENTS: Components = {
  a: LINK_COMPONENT,
};

const passthrough = ({ children }: { children?: React.ReactNode }): React.JSX.Element => (
  <>{children}</>
);

const INLINE_COMPONENTS: Components = {
  a: LINK_COMPONENT,
  p: passthrough,
  ul: passthrough,
  ol: passthrough,
  li: ({ children }) => <>{children} </>,
  h1: passthrough,
  h2: passthrough,
  h3: passthrough,
  h4: passthrough,
  blockquote: passthrough,
};

export function MarkdownText({
  content,
  inline = false,
  className = "",
}: {
  content: string;
  inline?: boolean;
  className?: string;
}): React.JSX.Element {
  const Wrapper = inline ? "span" : "div";
  return (
    <Wrapper
      className={`markdown-text ${inline ? "markdown-text-inline" : "markdown-text-block"} ${className}`.trim()}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={inline ? INLINE_COMPONENTS : BLOCK_COMPONENTS}>
        {content}
      </ReactMarkdown>
    </Wrapper>
  );
}
