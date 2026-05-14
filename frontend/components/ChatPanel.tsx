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

export function ChatPanel({ projectId, isOpen, onClose }: Props) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [thinking, setThinking] = React.useState<string | null>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  // close on Escape
  React.useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  async function send() {
    if (!input.trim() || loading) return;
    const userMsg: ChatMessage = { role: "user", content: input.trim() };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);
    setThinking(null);

    let assistantText = "";
    const next = [...messages, userMsg];
    try {
      for await (const token of streamChat(projectId, next)) {
        if (token.type === "thinking") {
          setThinking(token.text);
        } else if (token.type === "text") {
          setThinking(null);
          assistantText += token.text;
          setMessages((m) => {
            const last = m[m.length - 1];
            return last?.role === "assistant"
              ? [...m.slice(0, -1), { role: "assistant", content: assistantText }]
              : [...m, { role: "assistant", content: assistantText }];
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
                  <button key={s} onClick={() => setInput(s)}
                    className="rounded-sm border border-border-default bg-page px-3 py-2 text-left t-body-sm text-secondary hover:bg-tint-navy hover:border-navy-200 hover:text-navy-700 transition-colors">
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
                <div key={i} className="self-start max-w-[94%]">
                  <div className="rounded-md rounded-bl-xs border border-border-default bg-page px-3 py-2 t-body-sm text-body">
                    {m.content ? <Markdown>{m.content}</Markdown> : <TypingDots className="text-tertiary py-0.5" />}
                  </div>
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
            {loading && !thinking && !lastIsAssistantWithText && (
              <div className="self-start max-w-[92%]">
                <div className="flex items-center gap-2 rounded-md border border-border-default bg-page px-3 py-2 t-body-sm text-tertiary">
                  <Spinner size="sm" className="shrink-0" />
                  <span className="italic">Thinking…</span>
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
            <Button size="md" onClick={send} disabled={loading || !input.trim()} className="min-w-[3.25rem]">
              {loading ? <Spinner size="sm" /> : "Ask"}
            </Button>
          </div>
          <div className="mt-1.5 t-body-xs text-tertiary">Enter to send · Shift+Enter for a newline · Esc to close</div>
        </div>
      </aside>
    </>
  );
}
