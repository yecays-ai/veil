"use client";
import { useBindings } from "../use-bindings";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore,
  type CSSProperties } from "react";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Copy,
  Ellipsis,
  Heart,
  Pencil,
  Plus,
  Quote,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  Square,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useFoundation } from "../foundation-provider";
import { chatEngine } from "../../lib/chat/engine";
import { chatStorage } from "../../lib/chat/storage";
import type { ChatMessage, ChatSession } from "../../lib/chat/types";
import {
  messageMenuPosition,
  selectMessageRange,
} from "../../lib/chat/message-actions";
import { ChatAvatar } from "./avatar";
import { useChatSession } from "./use-chat-session";
import { useKeyboardDismissAutoReply } from "./use-keyboard-dismiss-auto-reply";
import { createTransientFeedback, hasPendingUserContent, sendThenRequestReply, visibleReplyText } from "../../lib/chat/usability";
import { groupVisibleMessages, hiddenForReveal } from "../../lib/chat/bubble-pacing";
import { resolveUserMessageDelivery, userMessageDeliveryLabel } from "../../lib/chat/delivery";
import { useBubbleReveal } from "./use-bubble-reveal";
import { useChatBackground } from "./use-chat-background";
import { ChatBackgroundSettings } from "./chat-background-settings";
import { CustomCSSSettings } from "./custom-css-settings";
import { SessionCustomCSS } from "./session-custom-css";
import { chatHeaderOffset, chatKeyboardInset } from "../../lib/chat/viewport";
import { getMessageActions, messageActionsRevision, runMessageAction, subscribeMessageActions } from "../../lib/chat/message-action-registry";
import { MessageFooter } from "./message-footer";
import { parseQuotedReply, quoteMessage } from "../../lib/chat/quote";
import { QuoteBubble } from "./quote-bubble";
import { resolveBindings } from "../../lib/bindings";
import { browserRegexStorage } from "../../lib/regex-storage";
import { resolveRegexGroups, type RegexGroup } from "../../lib/regex";
import { applyRegex } from "../../lib/regex-engine";

export function ChatRoom({ characterId }: { characterId: string }) {
  useSyncExternalStore(subscribeMessageActions, messageActionsRevision, () => 0);
  const { document, ready } = useFoundation();
  const { bindings } = useBindings();
  const character = document.characters.find(
    (c) => c.characterId === characterId,
  );
  const [regexGroups, setRegexGroups] = useState<RegexGroup[]>([]);
  const regexIds = resolveBindings(bindings, characterId, "messages").regexIds;
  const regexKey = regexIds?.join("\u0000") ?? "*";
  useEffect(() => {
    let active = true;
    const load = () => void browserRegexStorage.load().then((saved) => {
      if (active) setRegexGroups(resolveRegexGroups(saved, regexIds));
    }).catch(() => { if (active) setRegexGroups([]); });
    load();
    window.addEventListener("storage", load);
    return () => { active = false; window.removeEventListener("storage", load); };
  // The key tracks the resolved ordered IDs without reloading on unrelated renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId, regexKey]);
  const { session, messages, loadError } = useChatSession(
    characterId,
    ready && !!character,
  );
  const chatBackground = useChatBackground(session);
  const empty = !!session && messages.length === 0 && !loadError;
  const [draft, setDraft] = useState("");
  const [quotingMessage, setQuotingMessage] = useState<ChatMessage | null>(null);
  useEffect(() => { setQuotingMessage(null); }, [characterId]);
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [feedbackController] = useState(() => createTransientFeedback(setFeedback));
  const sendingLock = useRef(false);
  const replyLock = useRef(false);
  const currentSessionId = useRef(session?.id);
  currentSessionId.current = session?.characterId === characterId ? session.id : undefined;
  const { queue: revealQueue, state: revealState } = useBubbleReveal(
    currentSessionId.current, messages, session?.streamOnline === true, !!loadError,
  );
  function showFeedback(text: string) {
    feedbackController.show(text);
  }
  useEffect(() => () => feedbackController.cancel(), [feedbackController]);
  const [activeMessage, setActiveMessage] = useState<ChatMessage | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionStartId, setSelectionStartId] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [chatInfoOpen, setChatInfoOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const history = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const mounted = useRef(true);
  const shell = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const composerBar = useRef<HTMLFormElement>(null);
  const actionMenu = useRef<HTMLDivElement>(null);
  const positionMenu = useRef<() => void>(() => {});
  const nativeSelectionActive = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    const textarea = composer.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, [draft]);
  useLayoutEffect(() => {
    const bar = composerBar.current;
    if (!bar || !shell.current) return;
    const update = () => shell.current?.style.setProperty("--chat-composer-height", `${bar.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const trackSelection = () => {
      const selection = window.getSelection();
      nativeSelectionActive.current = !!selection && !selection.isCollapsed &&
        !!selection.toString();
    };
    globalThis.document.addEventListener("selectionchange", trackSelection);
    return () => globalThis.document.removeEventListener("selectionchange", trackSelection);
  }, []);

  const closeActions = useCallback(() => {
    setActiveMessage(null);
    setMenuAnchor(null);
  }, []);
  useLayoutEffect(() => {
    if (!activeMessage || !menuAnchor || !actionMenu.current || !shell.current) return;
    const menu = actionMenu.current;
    const position = () => {
      if (!menu.isConnected || !menuAnchor.isConnected || !shell.current) return;
      const rect = menuAnchor.getBoundingClientRect();
      const viewportRect = shell.current.getBoundingClientRect();
      const scaleX = viewportRect.width / shell.current.clientWidth || 1;
      const scaleY = viewportRect.height / shell.current.clientHeight || 1;
      menu.style.maxWidth = `${Math.max(0, shell.current.clientWidth - 16)}px`;
      const naturalHeight = menu.scrollHeight + menu.offsetHeight - menu.clientHeight;
      const result = messageMenuPosition({
        left: (rect.left - viewportRect.left) / scaleX,
        right: (rect.right - viewportRect.left) / scaleX,
        top: (rect.top - viewportRect.top) / scaleY,
        bottom: (rect.bottom - viewportRect.top) / scaleY,
      }, { width: menu.offsetWidth, height: naturalHeight }, {
        width: shell.current.clientWidth,
        height: shell.current.clientHeight,
      });
      Object.assign(menu.style, { left: `${result.left}px`, top: `${result.top}px`,
        maxHeight: `${result.maxHeight}px`, visibility: "visible" });
    };
    positionMenu.current = position;
    const openedAt = performance.now();
    let frame = requestAnimationFrame(function track() {
      position();
      if (performance.now() < openedAt + 180) frame = requestAnimationFrame(track);
    });
    const observer = new ResizeObserver(position);
    observer.observe(menuAnchor);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [activeMessage, menuAnchor]);

  function openActions(e: React.MouseEvent<HTMLElement>, message: ChatMessage) {
    if (multiSelect || message.status === "streaming") return;
    const selection = window.getSelection();
    if (nativeSelectionActive.current ||
      (selection && !selection.isCollapsed && selection.toString())) return;
    setActiveMessage(message);
    setMenuAnchor(e.currentTarget);
    setChatInfoOpen(false);
  }
  async function copyMessage() {
    if (!activeMessage) return;
    try { await navigator.clipboard.writeText(activeMessage.content); showFeedback("Copied"); }
    catch { setError("Message could not be copied."); }
    closeActions();
  }
  async function deleteConfirmed() {
    if (!session || !confirmDelete) return;
    try { await chatStorage.deleteMessages(session.id, confirmDelete); revealQueue.discard(confirmDelete); showFeedback("Deleted");
      setConfirmDelete(null); setMultiSelect(false); setSelectedIds(new Set()); }
    catch (e) { setError(e instanceof Error ? e.message : "Messages could not be deleted."); }
  }
  useEffect(() => {
    if (nearBottom.current)
      history.current?.scrollTo({ top: history.current.scrollHeight });
  }, [messages, revealState]);
  // Preserve the original header safe area across keyboard transitions and
  // compensate visual viewport panning independently of the composer.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let frame = 0;
    let safeTop = 0;
    // Measure env() independently: reading the header after setting its cached
    // padding would keep reading our own override (including an initial zero).
    const safeAreaProbe = globalThis.document.createElement("div");
    safeAreaProbe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;padding-top:env(safe-area-inset-top, 0px)";
    globalThis.document.body.appendChild(safeAreaProbe);
    const measureSafeTop = () => {
      safeTop = Math.max(safeTop, parseFloat(getComputedStyle(safeAreaProbe).paddingTop) || 0);
    };
    measureSafeTop();
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const room = shell.current;
        const screen = room?.closest<HTMLElement>(".phone-shell");
        if (!room || !screen) return;
        const mobile = window.matchMedia(
          "(hover: none) and (pointer: coarse)",
        ).matches;
        const inputFocused = composer.current === globalThis.document.activeElement;
        if (!mobile) {
          room.style.removeProperty("--chat-viewport-top");
          room.style.removeProperty("--chat-safe-top");
          room.style.removeProperty("--chat-keyboard-inset");
          return;
        }
        measureSafeTop();
        if (safeTop > 0) {
          room.style.setProperty("--chat-safe-top", `${safeTop}px`);
        } else {
          room.style.removeProperty("--chat-safe-top");
        }
        room.style.setProperty(
          "--chat-viewport-top",
          `${chatHeaderOffset(viewport.offsetTop, window.scrollY)}px`,
        );
        if (!inputFocused) {
          room.style.removeProperty("--chat-keyboard-inset");
          return;
        }
        const inset = chatKeyboardInset(
          screen.clientHeight,
          viewport,
          window.scrollY,
          window.innerHeight,
        );
        room.style.setProperty("--chat-keyboard-inset", `${inset}px`);
        if (nearBottom.current)
          history.current?.scrollTo({ top: history.current.scrollHeight });
      });
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("scroll", update, true);
    globalThis.document.addEventListener("focusin", update);
    globalThis.document.addEventListener("focusout", update);
    window.addEventListener("orientationchange", update);
    return () => {
      cancelAnimationFrame(frame);
      safeAreaProbe.remove();
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("scroll", update, true);
      globalThis.document.removeEventListener("focusin", update);
      globalThis.document.removeEventListener("focusout", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [ready]);
  async function persistDraft(content: string, sessionId: string, focus: boolean) {
    sendingLock.current = true;
    setSending(true);
    try {
      nearBottom.current = true;
      const quote = quotingMessage;
      await chatEngine.send(sessionId, content, quote?.id);
      if (mounted.current && currentSessionId.current === sessionId) {
        setQuotingMessage((current) => current?.id === quote?.id ? null : current);
        setDraft((current) => (current === content ? "" : current));
        if (focus) composer.current?.focus();
      }
    } finally {
      sendingLock.current = false;
      if (mounted.current) setSending(false);
    }
  }
  async function send() {
    if (!session || session.characterId !== characterId || sendingLock.current || !draft.trim() || loadError) return;
    setError("");
    try {
      await persistDraft(draft, session.id, true);
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error ? e.message : "Message could not be saved.",
        );
    }
  }
  async function reply() {
    if (!session || session.characterId !== characterId || replyLock.current || sendingLock.current ||
      chatEngine.isGenerating(session.id) || loadError) return;
    const sessionId = session.id;
    replyLock.current = true;
    let revealToken: number | undefined;
    setGenerating(true);
    setError("");
    nearBottom.current = true;
    try {
      await sendThenRequestReply(draft,
        (content) => persistDraft(content, sessionId, false),
        async () => {
          if (mounted.current && currentSessionId.current === sessionId) {
            revealToken = revealQueue.begin(sessionId, messages, session.streamOnline === true, performance.now());
            const token = revealToken;
            return chatEngine.requestReply(sessionId, (completed) => {
              if (mounted.current && currentSessionId.current === sessionId)
                revealQueue.complete(sessionId, completed, performance.now(), token);
            });
          }
        });
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error ? e.message : "Reply could not be requested.",
        );
    } finally {
      revealQueue.settle(sessionId, revealToken);
      replyLock.current = false;
      if (mounted.current) setGenerating(false);
    }
  }
  async function regenerate(message: ChatMessage) {
    if (!session || generating || revealState?.pending || replyLock.current || chatEngine.isGenerating(session.id)) return;
    const sessionId = session.id;
    replyLock.current = true;
    closeActions();
    setGenerating(true);
    nearBottom.current = true;
    const retained = messages.filter((item) => item.order < message.order);
    const revealToken = revealQueue.begin(sessionId, retained, session.streamOnline === true, performance.now());
    setError("");
    try {
      await chatEngine.regenerateMessage(message.id, (completed) => {
        if (mounted.current && currentSessionId.current === sessionId)
          revealQueue.complete(sessionId, completed, performance.now(), revealToken);
      }, sessionId);
    } catch (reason) {
      if (mounted.current && currentSessionId.current === sessionId)
        setError(reason instanceof Error ? reason.message : "Message could not be regenerated.");
    } finally {
      replyLock.current = false;
      if (mounted.current && currentSessionId.current === sessionId) {
        revealQueue.settle(sessionId, revealToken);
        setGenerating(false);
      }
    }
  }
  useKeyboardDismissAutoReply(shell, {
    sessionId: session?.characterId === characterId ? session.id : undefined,
    enabled: session?.autoReplyOnKeyboardDismiss === true,
    blocked: generating || !!revealState?.pending || sending || multiSelect || !!activeMessage || !!editingMessage ||
      chatInfoOpen || confirmClear || !!confirmDelete,
    onReply: reply,
  });
  async function updateSetting(patch: {
    streamOnline?: boolean;
    autoReplyOnKeyboardDismiss?: boolean;
    pinned?: boolean;
    backgroundImage?: string | null;
    backgroundBlur?: number | null;
  }) {
    if (!session) return;
    try { await chatStorage.updateSessionSettings(session.id, patch); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Setting could not be saved."); }
  }
  if (!ready)
    return (
      <div className="chat-app">
        <p className="chat-notice">Loading Character…</p>
      </div>
    );
  if (!character)
    return (
      <div className="chat-app">
        <Link href="/messages">‹ Messages</Link>
        <p className="chat-notice">This Character is no longer available.</p>
      </div>
    );
  const pending = hasPendingUserContent(messages);
  const selectable = messages.filter((message) => message.status !== "streaming");
  const hidden = (message: ChatMessage) =>
    (!!revealState && hiddenForReveal(message, revealState)) ||
    (generating && session?.streamOnline !== true && message.role === "assistant" && message.status === "streaming");
  const visibleMessages = messages.filter((message) => !hidden(message));
  const groupedMessages = groupVisibleMessages(visibleMessages);
  const lastVisibleMessageId = groupedMessages.at(-1)?.message.id;
  const typing = !!revealState?.pending || (generating && session?.streamOnline !== true);
  const firstHiddenIndex = messages.findIndex(hidden);
  const typingBeforeId = firstHiddenIndex < 0 ? undefined :
    messages.slice(firstHiddenIndex + 1).find((message) => !hidden(message))?.id;
  const typingIndicator = typing && <div className="chat-turn chat-turn-assistant chat-msg-wrapper" role="status" aria-label="Typing">
    <div className="chat-avatar-column chat-msg-avatar"><ChatAvatar profile={character} /></div><div className="chat-message">
      <p className="chat-bubble chat-bubble-role-assistant"><span className="chat-typing-dots" aria-hidden="true"><i /><i /><i /></span></p>
    </div>
  </div>;
  return (
    <div className="chat-app chat-room chat-room-wrapper" ref={shell}
      style={chatBackground.url ? {
        "--chat-background-image": `url(${JSON.stringify(chatBackground.url)})`,
        "--chat-background-blur": `${chatBackground.blur}px`,
        "--chat-background-inset": chatBackground.blur ? `${-2 * chatBackground.blur}px` : "0px",
      } as CSSProperties : undefined}
      data-chat-background={chatBackground.url ? "custom" : "default"}
      data-context-menu-open={activeMessage ? "" : undefined}>
      {session?.customCSS && <SessionCustomCSS css={session.customCSS} />}
      <header className="chat-header page-header">
        <Link
          href="/messages"
          className="chat-back page-back-btn"
          aria-label="Back to Messages"
        >
          <ChevronLeft aria-hidden="true" />
        </Link>
        <div className="chat-contact-summary page-title" aria-label={`${session?.remark || character.name} contact details`}>
          <ChatAvatar profile={character} />
          <strong>{session?.remark || character.name}</strong>
          <ChevronRight aria-hidden="true" />
        </div>
        <button type="button" className="chat-settings-button page-back-btn" aria-label="Conversation settings"
          title="Conversation settings"
          onClick={() => setChatInfoOpen(true)}><Ellipsis aria-hidden="true" /></button>
      </header>
      <div
        className={`chat-history chat-scroll-anchored${empty ? " chat-history-empty" : ""}`}
        ref={history}
        aria-label="Conversation history"
        onScroll={() => {
          const el = history.current;
          if (el)
            nearBottom.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (activeMessage) positionMenu.current();
        }}
      >
        {!session && (
          <p className="chat-notice">
            {loadError ? "Conversation unavailable." : "Loading conversation…"}
          </p>
        )}
        {empty && <p className="chat-empty-state">No messages yet</p>}
        {groupedMessages.map(({ message, showTimestamp, isGroupStart, isGroupEnd }) => {
          const delivery = isGroupEnd ? resolveUserMessageDelivery(message) : null;
          // Middle of a same-sender group: neither end keeps a full radius.
          const groupClass = `${isGroupStart ? " chat-group-start" : ""}${isGroupEnd ? " chat-group-end" : ""}${isGroupStart || isGroupEnd ? "" : " chat-group-middle"}`;
          const visibleText = visibleReplyText(message, session?.streamOnline === true);
          const parsed = message.role === "assistant" ? parseQuotedReply(visibleText)
            : { content: visibleText, preview: null };
          const quotePreview = message.quote?.preview ?? parsed.preview;
          return (
          <Fragment key={message.id}>
            {typingBeforeId === message.id && typingIndicator}
            {showTimestamp && <div className="chat-time-separator chat-sys-msg">
              <time dateTime={new Date(message.createdAt).toISOString()}>
                {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </time>
            </div>}
          <div
            className={`chat-turn chat-msg-wrapper chat-turn-${message.role}${groupClass}${selectedIds.has(message.id) ? " chat-turn-selected" : ""}`}
            data-message-id={message.id}
            data-consecutive={!isGroupStart ? "" : undefined}
            data-active={activeMessage?.id === message.id ? "" : undefined}
            onClick={() => {
              if (!multiSelect || message.status === "streaming") return;
              setSelectedIds((current) => { const next = new Set(current);
                if (next.has(message.id)) next.delete(message.id); else next.add(message.id); return next; });
            }}
          >
            {multiSelect && <span className="chat-selection-control" aria-hidden="true">
              {selectedIds.has(message.id) ? "✓" : ""}
            </span>}
            {message.role === "assistant" && <div className="chat-avatar-column chat-msg-avatar">
              {isGroupStart && <ChatAvatar profile={character} />}
            </div>}
            <div className="chat-message">
              <p className={`chat-bubble chat-bubble-role-${message.role} chat-markdown`}
                onPointerDown={() => { nativeSelectionActive.current = false; }}
                onContextMenu={() => { nativeSelectionActive.current = true; }}
                onClick={(e) => openActions(e, message)}>
                {quotePreview !== null && quotePreview !== undefined && <QuoteBubble preview={quotePreview}
                  author={message.quote ? (message.quote.role === "user" ? "You" : character.name) : undefined} />}
                {(parsed.content && (message.role === "user" || message.role === "assistant")
                  ? applyRegex(parsed.content, regexGroups, message.role, "display",
                    { character: character.name, user: document.user.name }) : parsed.content) ||
                  (message.status === "streaming" && generating ? "…" : "")}
              </p>
              <MessageFooter messageId={message.id} />
              <span className="chat-message-meta">
                {message.status === "streaming" && !generating && (
                  <span>Interrupted reply</span>
                )}
                {message.status === "cancelled" && <span>Reply stopped</span>}
                {message.status === "error" && (
                  <span role="alert">{message.error || "Reply failed."}</span>
                )}
                {delivery && !typing && message.id === lastVisibleMessageId && <span className="chat-delivery-status">
                  {userMessageDeliveryLabel(delivery)}
                </span>}
              </span>
            </div>
          </div>
          </Fragment>
        );})}
        {!typingBeforeId && typingIndicator}
      </div>
      {(error || loadError) && (
        <p role="alert" className="chat-notice chat-error">
          {error || loadError}
        </p>
      )}
      {feedback && <div className="chat-feedback-toast" role="status">{feedback}</div>}
      {multiSelect && <div className="chat-multi-select-bar">
        <span>{selectedIds.size} selected</span>
        <button type="button" onClick={() => setSelectedIds(new Set(selectable.map((m) => m.id)))}>Select all</button>
        <button type="button" disabled={!selectionStartId} onClick={() => selectionStartId &&
          setSelectedIds(new Set(selectMessageRange(selectable.map((m) => m.id), selectionStartId)))}>
          Select from here to latest
        </button>
        <button type="button" className="chat-danger" disabled={!selectedIds.size}
          onClick={() => setConfirmDelete([...selectedIds])}>Delete selected</button>
        <button type="button" onClick={() => { setMultiSelect(false); setSelectedIds(new Set()); }}>Cancel</button>
      </div>}
      <form
        className="chat-composer chat-input-bar"
        ref={composerBar}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {quotingMessage && <div className="chat-quote-bar">
          <QuoteBubble preview={quoteMessage(quotingMessage).preview}
            author={quotingMessage.role === "user" ? "You" : character.name} />
          <button type="button" aria-label="Cancel Quote" onClick={() => setQuotingMessage(null)}>×</button>
        </div>}
        <button type="button" className="chat-composer-icon chat-composer-plus"
          aria-label="More message options" title="More message options">
          <Plus aria-hidden="true" />
        </button>
        <div className="chat-input-shell">
          <label className="chat-input-label" htmlFor="chat-input">Message</label>
          <textarea
            className="chat-input-textarea"
            id="chat-input"
            ref={composer}
            rows={1}
            maxLength={12000}
            value={draft}
            disabled={!session || !!loadError}
            placeholder="Message…"
            onChange={(e) => setDraft(e.target.value)}
          />
          <span className="chat-voice-slot" aria-hidden="true" />
        </div>
        <div className="chat-composer-actions chat-input-actions">
          {generating || revealState?.pending ? (
            <button type="button" className="chat-composer-icon" aria-label="Stop reply" title="Stop reply"
              onClick={() => {
                revealQueue.cancel();
                if (session) chatEngine.stop(session.id);
              }}>
              <Square aria-hidden="true" />
            </button>
          ) : session?.autoReplyOnKeyboardDismiss !== true ? (
            <button
              type="button"
              className="chat-composer-icon chat-request-reply"
              aria-label="Request Reply"
              title="Request Reply"
              onPointerDown={(e) => e.preventDefault()}
              disabled={!session || (!pending && !draft.trim()) || sending || !!loadError}
              onClick={() => void reply()}
            >
              <Sparkles aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="submit"
            className="chat-composer-icon chat-send"
            aria-label="Send"
            title="Send"
            onPointerDown={(e) => e.preventDefault()}
            disabled={!session || sending || !draft.trim() || !!loadError}
          >
            <SendHorizontal aria-hidden="true" />
          </button>
        </div>
      </form>
      {chatInfoOpen && <ChatInfoScreen
        session={session}
        streamOnline={session?.streamOnline === true}
        autoReplyOnKeyboardDismiss={session?.autoReplyOnKeyboardDismiss === true}
        pinned={session?.pinned === true}
        canClear={messages.length > 0 && !generating}
        onBack={() => setChatInfoOpen(false)}
        onUpdate={updateSetting}
        onClear={() => setConfirmClear(true)}
      />}
      {activeMessage && <>
        <button className="chat-context-backdrop" aria-label="Close message actions" onClick={closeActions} />
        <div ref={actionMenu} className="chat-message-actions ctx-menu" role="menu" aria-label="Message actions"
          style={{ left: 0, top: 0, visibility: "hidden" }} onPointerDown={(e) => e.stopPropagation()}>
          <div className="chat-message-actions-grid">
            <Action label="Copy" icon={Copy} onClick={() => void copyMessage()} />
            <Action label="Edit" icon={Pencil} onClick={() => { setEditingMessage(activeMessage);
              setEditText(activeMessage.content); closeActions(); }} />
            <Action label="Quote" icon={Quote} disabled={activeMessage.role === "system"} onClick={() => {
              setQuotingMessage(activeMessage); closeActions(); composer.current?.focus();
            }} />
            <Action label="React" icon={Heart} disabled />
            <Action label="Select" icon={CircleCheck} onClick={() => { const id = activeMessage.id;
              setMultiSelect(true); setSelectionStartId(id); setSelectedIds(new Set([id])); closeActions(); }} />
            <Action label="Favorite" icon={Bookmark} disabled />
            <Action label="Delete" icon={Trash2} danger onClick={() => { setConfirmDelete([activeMessage.id]); closeActions(); }} />
            <Action label="Regenerate" icon={RotateCcw}
              disabled={activeMessage.role !== "assistant" || activeMessage.status !== "complete" || generating || !!revealState?.pending}
              onClick={() => void regenerate(activeMessage)} />
            {getMessageActions(activeMessage).map((action) => <Action key={action.id}
              label={action.label} icon={Plus} onClick={() => {
                const message = activeMessage;
                closeActions();
                void runMessageAction(action.id, message, {
                  updateMessage: (patch) => chatStorage.editMessage(message.id, patch.content),
                  toast: showFeedback,
                }).catch((reason) => setError(reason instanceof Error ? reason.message : "Message action failed."));
              }} />)}
          </div>
        </div>
      </>}
      {editingMessage && <div className="chat-dialog-backdrop">
        <form className="chat-dialog" onSubmit={async (e) => { e.preventDefault();
          try { await chatStorage.editMessage(editingMessage.id, editText); setEditingMessage(null); showFeedback("Saved"); }
          catch (reason) { setError(reason instanceof Error ? reason.message : "Message could not be saved."); } }}>
          <h2>Edit Message</h2><textarea autoFocus maxLength={12000} value={editText}
            onChange={(e) => setEditText(e.target.value)} />
          <div><button type="button" onClick={() => setEditingMessage(null)}>Cancel</button>
            <button type="submit" disabled={!editText.trim()}>Save</button></div>
        </form>
      </div>}
      {confirmDelete && <ConfirmDialog title="Delete messages?"
        text={`Delete ${confirmDelete.length} message${confirmDelete.length === 1 ? "" : "s"} from this conversation?`}
        onCancel={() => setConfirmDelete(null)} onConfirm={() => void deleteConfirmed()} />}
      {confirmClear && <ConfirmDialog title="Clear Chat History?"
        text={`Delete all ${messages.length} messages from this conversation? The conversation itself will remain.`}
        onCancel={() => setConfirmClear(false)} onConfirm={async () => {
          if (!session) return;
          try { await chatStorage.clearSession(session.id); revealQueue.cancel(); setConfirmClear(false); showFeedback("Conversation cleared"); }
          catch (reason) { setError(reason instanceof Error ? reason.message : "Conversation could not be cleared."); }
        }} />}
    </div>
  );
}

function ChatInfoScreen({ session, streamOnline, autoReplyOnKeyboardDismiss, pinned, canClear, onBack, onUpdate, onClear }: {
  session: ChatSession | null;
  streamOnline: boolean;
  autoReplyOnKeyboardDismiss: boolean;
  pinned: boolean;
  canClear: boolean;
  onBack: () => void;
  onUpdate: (patch: {
    streamOnline?: boolean;
    autoReplyOnKeyboardDismiss?: boolean;
    pinned?: boolean;
  }) => Promise<void>;
  onClear: () => void;
}) {
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [customCSSOpen, setCustomCSSOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  if (backgroundOpen && session)
    return <ChatBackgroundSettings session={session} onBack={() => setBackgroundOpen(false)} />;
  if (customCSSOpen && session)
    return <CustomCSSSettings session={session} onBack={() => setCustomCSSOpen(false)} />;
  if (searchOpen) return <ChatHistorySearchPlaceholder onBack={() => setSearchOpen(false)} />;
  return <section className="chat-info-screen" aria-label="Chat Info">
    <header className="chat-info-header">
      <button type="button" className="chat-info-back" aria-label="Back to conversation" onClick={onBack}>
        <ChevronLeft aria-hidden="true" />
      </button>
      <h1>Chat Info</h1>
      <span className="chat-info-header-spacer" aria-hidden="true" />
    </header>
    <div className="chat-info-body">
      <section className="chat-info-group" aria-label="Chat history">
        <button type="button" className="chat-session-setting chat-info-row"
          onClick={() => setSearchOpen(true)}>
          <span>Search Chat History</span><ChevronRight aria-hidden="true" />
        </button>
      </section>
      <section className="chat-info-group" aria-label="Conversation settings">
        <label className="chat-session-setting chat-info-toggle"><span>Pin Conversation</span>
          <input className="chat-info-switch" type="checkbox" checked={pinned} disabled={!session}
            onChange={(event) => void onUpdate({ pinned: event.target.checked })} /></label>
      </section>
      <section className="chat-info-group" aria-label="Appearance">
        <button type="button" className="chat-session-setting chat-info-row"
          disabled={!session} onClick={() => setBackgroundOpen(true)}>
          <span>Chat Background<small>{session?.backgroundImage ? "Custom background" : "Following global"}</small></span>
          <ChevronRight aria-hidden="true" />
        </button>
        <button type="button" className="chat-session-setting chat-info-row"
          disabled={!session} onClick={() => setCustomCSSOpen(true)}>
          <span>Custom CSS<small>{session?.customCSS ? "Only this conversation · Set" : "Only this conversation"}</small></span>
          <ChevronRight aria-hidden="true" />
        </button>
      </section>
      <section className="chat-info-group" aria-label="Chat behavior">
        <label className="chat-session-setting"><span>Streaming Replies
          <small>Show replies as they are generated.</small></span>
          <input className="chat-info-switch" type="checkbox" checked={streamOnline} disabled={!session}
            onChange={(event) => void onUpdate({ streamOnline: event.target.checked })} /></label>
        <label className="chat-session-setting chat-info-toggle"><span>Reply When Keyboard Closes</span>
          <input className="chat-info-switch" type="checkbox" checked={autoReplyOnKeyboardDismiss} disabled={!session}
            onChange={(event) => void onUpdate({ autoReplyOnKeyboardDismiss: event.target.checked })} /></label>
      </section>
      <section className="chat-info-group chat-info-danger-group" aria-label="Danger">
        <button type="button" className="chat-session-setting chat-info-clear chat-danger"
          disabled={!canClear} onClick={onClear}>Clear Chat History</button>
      </section>
    </div>
  </section>;
}

function ChatHistorySearchPlaceholder({ onBack }: { onBack: () => void }) {
  return <section className="chat-info-screen" aria-label="Search Chat History">
    <header className="chat-info-header">
      <button type="button" className="chat-info-back" aria-label="Back to Chat Info" onClick={onBack}>
        <ChevronLeft aria-hidden="true" />
      </button>
      <h1>Search Chat History</h1>
      <span className="chat-info-header-spacer" aria-hidden="true" />
    </header>
    <div className="chat-info-body">
      <p className="chat-info-search-unavailable">Search for messages in this conversation will be available here.</p>
    </div>
  </section>;
}

function Action({ label, icon, disabled, danger, onClick }: {
  label: string; icon: LucideIcon; disabled?: boolean; danger?: boolean; onClick?: () => void;
}) {
  const Icon = icon;
  return <button type="button" role="menuitem" disabled={disabled} onClick={onClick}
    className={`ctx-menu-btn${danger ? " ctx-menu-btn-danger chat-danger" : ""}`}><Icon size={25} strokeWidth={1.75}
      aria-hidden="true" /><small>{label}</small></button>;
}

function ConfirmDialog({ title, text, onCancel, onConfirm }: {
  title: string; text: string; onCancel: () => void; onConfirm: () => void;
}) {
  return <div className="chat-dialog-backdrop"><div className="chat-dialog" role="alertdialog"
    aria-modal="true" aria-labelledby="chat-confirm-title"><h2 id="chat-confirm-title">{title}</h2>
    <p>{text}</p><div><button type="button" onClick={onCancel}>Cancel</button>
      <button type="button" className="chat-danger" onClick={onConfirm}>Delete</button></div></div></div>;
}
