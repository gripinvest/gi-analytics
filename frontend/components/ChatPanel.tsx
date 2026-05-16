"use client";

import * as React from "react";
import { streamChat, type ChatMessage } from "@/lib/api";
import { Button, Markdown, Spinner, TypingDots } from "@/components/ui";

interface Props {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
}

const STARTERS = [
  "What's the zero-result rate by feature week?",
  "Which search terms have the worst zero-result rate?",
  "Show the top 10 most-searched terms",
  "How does click position distribute across results?",
];

// Editorial-themed cycling phrases shown while we're waiting on the model.
// 600ms-2500ms rotation keeps the UI alive during the advisor latency +
// first tool call (which together can sit at 3-5s before any token streams).
// Keeping these inside the printer/typesetter metaphor stays in voice for the
// editorial design and reinforces "this is computing, not stuck".
const CYCLE_PHRASES = [
  "Setting type…",
  "Composing the issue…",
  "Reading the dispatch…",
  "Indexing the figures…",
  "Drafting the byline…",
  "Folding the page…",
  "Going to press…",
];

export function ChatPanel({ projectId, isOpen, onClose }: Props) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [thinking, setThinking] = React.useState<string | null>(null);
  // Rotates while loading AND no specific thinking message has come back from
  // the server yet (i.e. we're in the advisor's window or the gap between
  // tool calls). Server-sent "Running: …" thinking events always win when
  // present — they're more specific.
  const [cycleIdx, setCycleIdx] = React.useState(0);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking, cycleIdx]);

  // close on Escape
  React.useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // Drive the cycling caption. Starts at a RANDOM index so short turns (~1s
  // rejections, ~2s simple lookups) show varied phrases even if the 2.2s
  // interval doesn't fire before the answer lands. Only ticks while the chat
  // is in-flight; cleans up immediately when the request finishes.
  React.useEffect(() => {
    if (!loading) { setCycleIdx(0); return; }
    setCycleIdx(Math.floor(Math.random() * CYCLE_PHRASES.length));
    const id = setInterval(() => setCycleIdx((i) => (i + 1) % CYCLE_PHRASES.length), 2200);
    return () => clearInterval(id);
  }, [loading]);

  // Accepts an optional override so suggestion chips (starters + follow-ups)
  // can auto-send without first stuffing the textarea and waiting for the
  // user to hit Enter — that copy-then-press dance was the bit that felt
  // broken.
  async function send(override?: string) {
    const content = (override ?? input).trim();
    if (!content || loading) return;
    const userMsg: ChatMessage = { role: "user", content };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);
    setThinking(null);

    let assistantText = "";
    // Advisor choice arrives as the first SSE event ({type: 'model'}); follow-
    // up suggestions arrive after the answer streams ({type: 'followups'}).
    // We capture both and attach them to the assistant message that the text
    // events build up.
    let assistantModel: ChatMessage["model"] | undefined;
    let assistantFollowups: string[] | undefined;
    const next = [...messages, userMsg];
    try {
      for await (const token of streamChat(projectId, next)) {
        if (token.type === "model") {
          assistantModel = token.label;
        } else if (token.type === "thinking") {
          setThinking(token.text ?? null);
        } else if (token.type === "text") {
          setThinking(null);
          assistantText += token.text ?? "";
          setMessages((m) => {
            const last = m[m.length - 1];
            const msg: ChatMessage = { role: "assistant", content: assistantText, model: assistantModel };
            return last?.role === "assistant"
              ? [...m.slice(0, -1), msg]
              : [...m, msg];
          });
        } else if (token.type === "followups") {
          assistantFollowups = token.suggestions;
          setMessages((m) => {
            const last = m[m.length - 1];
            if (last?.role !== "assistant") return m;
            return [...m.slice(0, -1), { ...last, followups: assistantFollowups }];
          });
        }
      }
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Could not reach the backend. Is it running on localhost:8000?" }]);
    } finally {
      setLoading(false);
      setThinking(null);
    }
  }

  // Tiny badge near the assistant message showing which model answered.
  // Off-topic rejects get a different glyph + colour to signal "this isn't a
  // real answer, it's a redirect".
  const MODEL_BADGES: Record<NonNullable<ChatMessage["model"]>, { glyph: string; label: string; cls: string }> = {
    haiku:  { glyph: "⚡", label: "Haiku",   cls: "text-tertiary" },
    sonnet: { glyph: "🧠", label: "Sonnet",  cls: "text-navy-700" },
    opus:   { glyph: "💎", label: "Opus",    cls: "text-warning-800" },
    reject: { glyph: "🚫", label: "Off-topic", cls: "text-error-600" },
  };

  if (!isOpen) return null;

  const last = messages[messages.length - 1];
  const lastIsAssistantWithText = !!(last && last.role === "assistant" && last.content);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-neutral-900/15 backdrop-blur-[1px] animate-rise" onClick={onClose} aria-hidden />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-[min(420px,100vw)] flex-col bg-surface shadow-lg border-l border-border-default animate-rise">
        <header className="flex items-center justify-between gap-3 border-b border-border-default px-4 py-3">
          <div className="min-w-0">
            <div className="t-heading-md text-heading">Ask the data</div>
            <div className="t-body-xs text-tertiary truncate">Claude writes SQL → DuckDB runs it → Claude explains · {projectId}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">✕</Button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div>
              <div className="t-overline text-tertiary mb-3">Try asking</div>
              <div className="flex flex-col gap-1.5">
                {STARTERS.map((s) => (
                  // Auto-send on click — copying to the input box and forcing
                  // the user to press Enter felt like a broken affordance.
                  <button key={s} onClick={() => send(s)} disabled={loading}
                    className="rounded-sm border border-border-default bg-page px-3 py-2 text-left t-body-sm text-secondary hover:bg-tint-navy hover:border-navy-200 hover:text-navy-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="self-end max-w-[88%]">
                  <div className="rounded-md rounded-br-xs bg-action px-3 py-2 t-body-sm text-on-primary whitespace-pre-wrap">{m.content}</div>
                </div>
              ) : (
                <div key={i} className="self-start max-w-[94%] flex flex-col gap-1">
                  <div className="rounded-md rounded-bl-xs border border-border-default bg-page px-3 py-2 t-body-sm text-body">
                    {m.content ? <Markdown>{m.content}</Markdown> : <TypingDots className="text-tertiary py-0.5" />}
                  </div>
                  {m.model && (
                    <div className={`t-body-xs ${MODEL_BADGES[m.model].cls} pl-0.5 inline-flex items-center gap-1`}>
                      <span aria-hidden>{MODEL_BADGES[m.model].glyph}</span>
                      <span>{MODEL_BADGES[m.model].label}</span>
                    </div>
                  )}
                  {/* Follow-up suggestion chips — auto-send on click. Only
                      renders for the most-recent assistant message and only
                      when we're not currently streaming a new answer, so the
                      panel never suggests next steps while an earlier turn
                      is still in flight. */}
                  {m.followups && m.followups.length > 0 && i === messages.length - 1 && !loading && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {m.followups.map((q) => (
                        <button
                          key={q}
                          onClick={() => send(q)}
                          className="rounded-full border border-border-default bg-page px-2.5 py-1 t-body-xs text-secondary hover:bg-tint-navy hover:border-navy-200 hover:text-navy-700 transition-colors"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}
            {thinking && (
              <div className="self-start max-w-[92%]">
                <div className="flex items-center gap-2 rounded-md border border-warning-200 bg-status-warning-bg px-3 py-2 t-body-sm text-warning-800">
                  <Spinner size="sm" className="shrink-0" />
                  <span className="italic">{thinking}</span>
                </div>
              </div>
            )}
            {/* Pre-stream / between-tool-calls state. We're loading but the
                server hasn't sent a specific "thinking" message and there
                isn't a streaming assistant message yet. Cycling phrase keeps
                the UI alive during the 3-5s advisor + first-tool-call window
                so the user knows something is happening. */}
            {loading && !thinking && !lastIsAssistantWithText && (
              <div className="self-start max-w-[92%]">
                <div className="flex items-center gap-2 rounded-md border border-border-default bg-page px-3 py-2 t-body-sm text-tertiary">
                  <Spinner size="sm" className="shrink-0" />
                  <span className="italic transition-opacity duration-200">
                    {CYCLE_PHRASES[cycleIdx]}
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="border-t border-border-default px-4 py-3">
          <div className="flex items-end gap-2">
            {/* autoFocus = focus on every mount. ChatPanel renders null when
                isOpen=false (see line 72), so the textarea remounts every open
                and autoFocus fires each time without needing a ref+useEffect. */}
            <textarea
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask a question about the data…"
              rows={1}
              disabled={loading}
              className="flex-1 resize-none rounded-sm border border-border-default bg-surface px-3 py-2 t-body-sm text-heading outline-none placeholder:text-tertiary focus:border-navy-400 disabled:bg-muted"
            />
            {/* Wrap in an arrow fn — send() now takes an optional string
                override (for suggestion chips). Passing `send` bare would
                hand the click MouseEvent in as `override`, which both
                type-errors and would send the event object as a question. */}
            <Button size="md" onClick={() => send()} disabled={loading || !input.trim()} className="min-w-[3.25rem]">
              {loading ? <Spinner size="sm" /> : "Ask"}
            </Button>
          </div>
          <div className="mt-1.5 t-body-xs text-tertiary">Enter to send · Shift+Enter for a newline · Esc to close</div>
        </div>
      </aside>
    </>
  );
}
