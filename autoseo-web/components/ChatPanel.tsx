"use client";

// Right panel — AI CMO chat. Posts to /api/chat which streams the model's
// reply over SSE (Kimi 2.5 via MeshAPI). Server route loads the company +
// pending proposals as context, so the model can answer questions about
// "what should I do next" with grounding.

import { useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

export function ChatPanel({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        `Hi — I'm your AutoSEO CMO. I can see ${companyName}'s pending proposals and ` +
        `audit results. Ask me what to ship first, or what your readiness score really ` +
        `means.`,
    },
  ]);
  const [streaming, setStreaming] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId,
          messages: [...messages, { role: "user", content: text }],
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Chat failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        // SSE parsing — lines that start with "data: " carry chunks.
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;
          try {
            const obj = JSON.parse(payload) as { delta?: string; error?: string };
            if (obj.error) throw new Error(obj.error);
            if (obj.delta) {
              setMessages((m) => {
                const copy = m.slice();
                copy[copy.length - 1] = {
                  role: "assistant",
                  content: copy[copy.length - 1].content + obj.delta,
                };
                return copy;
              });
            }
          } catch {
            // ignore malformed lines
          }
        }
      }
    } catch (err) {
      setMessages((m) => {
        const copy = m.slice();
        copy[copy.length - 1] = {
          role: "assistant",
          content: `Chat error: ${err instanceof Error ? err.message : "unknown"}`,
        };
        return copy;
      });
    } finally {
      setStreaming(false);
      requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
      });
    }
  }

  return (
    <section className="panel flex h-[80vh] flex-col">
      <div className="panel-header">
        <span>AI CMO</span>
        <span className="font-mono text-[11px] text-ink-3">kimi-k2.5 · meshapi</span>
      </div>
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-auto max-w-[85%] rounded-lg bg-ink px-3 py-2 text-[13px] text-white"
                : "max-w-[90%] rounded-lg border border-line bg-card-2 px-3 py-2 text-[13px] text-ink"
            }
          >
            {m.content || (
              <span className="text-ink-3">…</span>
            )}
          </div>
        ))}
      </div>
      <form
        className="flex items-center gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          className="flex-1 rounded-full border border-line bg-card-2 px-4 py-2 text-[13px] focus:outline-none"
          placeholder="Ask the CMO anything…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={streaming}
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          className="btn btn-primary px-4 py-2 text-[13px] disabled:opacity-50"
        >
          {streaming ? "…" : "Send"}
        </button>
      </form>
    </section>
  );
}
