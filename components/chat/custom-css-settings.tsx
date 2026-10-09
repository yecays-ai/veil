"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { chatStorage } from "../../lib/chat/storage";
import type { ChatSession } from "../../lib/chat/types";
import { CHAT_SESSION_CSS_EXAMPLE, validateSessionCSS } from "../../lib/chat/custom-css";

export function CustomCSSSettings({ screenRef, session, onBack }: {
  screenRef?: React.Ref<HTMLElement>;
  session: ChatSession;
  onBack: () => void;
}) {
  const ownsEditor = useRef(true);
  const [draft, setDraft] = useState(session.customCSS || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    ownsEditor.current = true;
    return () => { ownsEditor.current = false; };
  }, []);
  async function save(css: string | null) {
    const problems = css ? validateSessionCSS(css) : [];
    if (problems.length) { setError(problems.join(" ")); return; }
    setBusy(true);
    setError("");
    try {
      await chatStorage.updateSessionSettings(session.id, { customCSS: css });
      if (!ownsEditor.current) return;
      setBusy(false);
      onBack();
    } catch (reason) {
      if (!ownsEditor.current) return;
      setError(reason instanceof Error ? reason.message : "Custom CSS could not be saved.");
      setBusy(false);
    }
  }
  return <section ref={screenRef} className="chat-info-screen chat-custom-css-screen" role="dialog" aria-modal="true" aria-label="Custom CSS">
    <header className="chat-info-header">
      <button type="button" className="chat-info-back" aria-label="Back to Chat Info" onClick={onBack}>
        <ChevronLeft aria-hidden="true" />
      </button>
      <h1>自定义 CSS</h1>
      <span className="chat-info-header-spacer" aria-hidden="true" />
    </header>
    <div className="chat-info-body chat-custom-css-body">
      <p>支持 :root 变量和选择器，仅作用于本会话。</p>
      <textarea aria-label="Conversation custom CSS" value={draft} spellCheck={false}
        placeholder={CHAT_SESSION_CSS_EXAMPLE} onChange={(event) => setDraft(event.target.value)} />
      {error && <p className="chat-custom-css-error" role="alert">{error}</p>}
      <div className="chat-custom-css-actions">
        <button type="button" disabled={busy} onClick={() => setDraft(CHAT_SESSION_CSS_EXAMPLE)}>Example</button>
        <button type="button" disabled={busy} onClick={() => void save(null)}>Clear</button>
        <button type="button" disabled={busy} onClick={() => void save(draft)}>Apply</button>
      </div>
    </div>
  </section>;
}

