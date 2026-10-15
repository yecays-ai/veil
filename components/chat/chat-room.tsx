"use client";
import { useBindings } from "../use-bindings";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore,
  type CSSProperties } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  SendHorizontal,
  Search,
  Sparkles,
  Square,
} from "lucide-react";
import { useFoundation } from "../foundation-provider";
import { chatEngine } from "../../lib/chat/engine";
import { setComposingDraft } from "../../lib/chat/composition";
import { chatStorage } from "../../lib/chat/storage";
import { MessageMemory } from "./message-memory";
import { LifeTimelineScreen } from "./life-timeline";
import { withMemoryClear } from "../../lib/memory/browser";
import { DEFAULT_BUBBLE_TIMING, type ChatMessage, type ChatSession } from "../../lib/chat/types";
import {
  selectMessageRange,
} from "../../lib/chat/message-actions";
import { ChatPlusPanel } from "./chat-plus-panel";
import { StickerPanel } from "./sticker-panel";
import { StickerManager } from "./sticker-manager";
import type { MessageSticker } from "../../lib/chat/sticker-message";
import { ChatAvatar } from "./avatar";
import { ChatHeader } from "./chat-header";
import { useCharacterPresence } from "../use-character-presence";
import { ChatMultiSelectBar } from "./chat-multi-select-bar";
import { useChatSession } from "./use-chat-session";
import { useKeyboardDismissAutoReply } from "./use-keyboard-dismiss-auto-reply";
import { createTransientFeedback, hasPendingUserContent } from "../../lib/chat/usability";
import { groupVisibleMessages, hiddenForReveal } from "../../lib/chat/bubble-pacing";
import { useBubbleReveal } from "./use-bubble-reveal";
import { useChatBackground } from "./use-chat-background";
import { ChatBackgroundSettings } from "./chat-background-settings";
import { CustomCSSSettings } from "./custom-css-settings";
import { Switch } from "../settings/ui/switch";
import { SessionCustomCSS } from "./session-custom-css";
import { chatHeaderOffset, chatKeyboardInset } from "../../lib/chat/viewport";
import { messageActionsRevision, runMessageAction, subscribeMessageActions } from "../../lib/chat/message-action-registry";
import { quoteMessage } from "../../lib/chat/quote";
import { QuoteBubble } from "./quote-bubble";
import { resolveBindings } from "../../lib/bindings";
import { browserRegexStorage } from "../../lib/regex-storage";
import { resolveRegexGroups, type RegexGroup } from "../../lib/regex";
import { createRegexReadGuard } from "../../lib/chat/regex-read-guard";
import { chatScrollIntentMatchesSession, shouldPositionChatHistoryAtBottom } from "../../lib/chat/initial-scroll";
import { SEARCH_RESULT_LIMIT, searchConversationMessages } from "../../lib/chat/search";
import { useContacts } from "../use-contacts";
import { contactDisplayName } from "../../lib/contact-storage";
import { chatLoadingNotice } from "../../lib/chat/loading-notice";
import { isChatDiagnosticsEnabled, recordChatDiagnostic } from "../../lib/diagnostics/chat-first-paint";
import { MessageList } from "./messages/message-list";
import { MessageActionsOverlay } from "./message-actions/message-actions-overlay";
import { useMessageActions } from "./message-actions/use-message-actions";
import { TransferComposer } from "./transfers/transfer-composer";
import { useTransferActions } from "./transfers/use-transfer-actions";
import { GiftComposer } from "./gifts/gift-composer";
import { useGiftActions } from "./gifts/use-gift-actions";

const LIFE_MODE_NOTICE = "Life Mode is on: they answer in their own time. Turn it off in Chat Info to get an answer now.";

export function ChatRoom({ characterId }: { characterId: string }) {
  useSyncExternalStore(subscribeMessageActions, messageActionsRevision, () => 0);
  useLayoutEffect(() => {
    recordChatDiagnostic("ChatRoom-commit-mount", { characterId });
    return () => recordChatDiagnostic("ChatRoom-commit-unmount", { characterId });
  }, [characterId]);
  const { document, ready } = useFoundation();
  const contacts = useContacts();
  const [bubbleTiming, setBubbleTiming] = useState(DEFAULT_BUBBLE_TIMING);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const refresh = () => {
      const requestRevision = ++revision;
      void chatStorage.readGlobalProfileSettings().then((settings) => {
        if (active && requestRevision === revision) setBubbleTiming(settings.bubbleTiming);
      }).catch(() => {});
    };
    refresh();
    const unsubscribe = chatStorage.subscribe((change) => {
      if (change.domain === "global-profile") refresh();
    });
    return () => { active = false; revision++; unsubscribe(); };
  }, []);
  const { bindings, ready: bindingsReady, error: bindingsError } = useBindings();
  const character = document.characters.find(
    (c) => c.characterId === characterId,
  );
  const contact = contacts.document.contacts.find((item) => item.characterId === characterId);
  const contactName = character ? contactDisplayName(contact, character.name) : "";
  const presence = useCharacterPresence(character);
  const [regexReadState, setRegexReadState] = useState<{
    owner: string; groups: RegexGroup[]; ready: boolean;
  }>({ owner: "", groups: [], ready: false });
  const [regexReadGuard] = useState(() => createRegexReadGuard());
  const regexIds = resolveBindings(bindings, characterId, "messages").regexIds;
  const regexKey = regexIds?.join("\u0000") ?? "*";
  const regexOwner = `${characterId}\u0000${regexKey}`;
  const bindingReadFailed = !bindingsReady && !!bindingsError;
  const regexGroups = bindingReadFailed ? [] : regexReadState.owner === regexOwner ? regexReadState.groups : [];
  const regexReady = bindingReadFailed || (bindingsReady && regexReadState.owner === regexOwner && regexReadState.ready);
  useEffect(() => {
    if (!bindingsReady) return;
    let active = true;
    const loadStartedAt = isChatDiagnosticsEnabled() ? performance.now() : null;
    if (loadStartedAt !== null) recordChatDiagnostic("regex-read-start", { characterId });
    const load = () => {
      const revision = regexReadGuard.next();
      void browserRegexStorage.load().then((saved) => {
        const resolved = resolveRegexGroups(saved, regexIds);
        if (active && regexReadGuard.isCurrent(revision)) {
          if (loadStartedAt !== null) recordChatDiagnostic("regex-ready", { characterId, rulesCount: resolved.length, durationMs: performance.now() - loadStartedAt });
          setRegexReadState({ owner: regexOwner, groups: resolved, ready: true });
        }
      }).catch(() => {
        if (active && regexReadGuard.isCurrent(revision)) {
          if (loadStartedAt !== null) recordChatDiagnostic("regex-failed", { characterId, error: true, durationMs: performance.now() - loadStartedAt });
          setRegexReadState({ owner: regexOwner, groups: [], ready: true });
        }
      });
    };
    load();
    window.addEventListener("storage", load);
    return () => {
      active = false;
      regexReadGuard.invalidate();
      window.removeEventListener("storage", load);
    };
  // The key tracks the Character identity and resolved ordered IDs without reloading on unrelated renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindingsReady, characterId, regexKey]);
  const { session, messages, loadError } = useChatSession(
    characterId,
    ready && !!character,
  );
  const chatBackground = useChatBackground(session, { characterId });
  const [publishedSessionId, setPublishedSessionId] = useState<string | null>(null);
  const frameReady = !!loadError || (!!session && chatBackground.readyForFrame && regexReady);
  useEffect(() => {
    // Keep the existing frame publication boundary after readiness.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (session && frameReady && publishedSessionId !== session.id) setPublishedSessionId(session.id);
  }, [session, frameReady, publishedSessionId]);
  const framePublished = !!loadError || (!!session && publishedSessionId === session.id);
  const empty = framePublished && !!session && messages.length === 0 && !loadError;
  const [draft, setDraft] = useState("");
  const draftEditVersion = useRef(0);
  // Life Mode waits while this conversation's composer holds text; leaving or switching clears the signal.
  const composingSessionId = session?.characterId === characterId ? session.id : undefined;
  const hasDraft = draft.trim().length > 0;
  useEffect(() => {
    if (!composingSessionId) return;
    setComposingDraft(composingSessionId, hasDraft);
    return () => setComposingDraft(composingSessionId, false);
  }, [composingSessionId, hasDraft]);
  const savedDraftAwaitingSession = useRef<{ sessionId: string; content: string; editVersion: number } | null>(null);
  const [quotingMessage, setQuotingMessage] = useState<ChatMessage | null>(null);
  useEffect(() => {
    // A character switch must clear the quote before the next send can use it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuotingMessage(null);
  }, [characterId]);
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const generationActive = generating || !!session?.generation;
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<null | "plus" | "stickers">(null);
  const [stickerManagerOpen, setStickerManagerOpen] = useState(false);
  const [failedDraft, setFailedDraft] = useState<{ sessionId: string; content: string; quote: ChatMessage | null; editVersion: number } | null>(null);
  const [feedback, setFeedback] = useState("");
  const [feedbackController] = useState(() => createTransientFeedback(setFeedback));
  const transfers = useTransferActions(session?.characterId === characterId ? session.id : undefined, setError,
    () => { setPanel(null); feedbackController.show("Transfer sent"); });
  const gifts = useGiftActions(session?.characterId === characterId ? session.id : undefined, setError,
    () => { setPanel(null); feedbackController.show("Gift sent"); });
  const sendingLock = useRef(false);
  const replyLock = useRef(false);
  const currentSessionId = useRef(session?.id);
  // Keep the session identity current for async reply guards.
  // eslint-disable-next-line react-hooks/refs
  currentSessionId.current = session?.characterId === characterId ? session.id : undefined;
  useEffect(() => {
    const saved = savedDraftAwaitingSession.current;
    if (!saved || currentSessionId.current !== saved.sessionId) return;
    savedDraftAwaitingSession.current = null;
    if (draftEditVersion.current === saved.editVersion)
      setDraft((current) => current === saved.content ? "" : current);
  }, [session?.id, characterId]);
  useEffect(() => {
    replyLock.current = false; sendingLock.current = false;
    // Reset transient reply state when the selected Character changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGenerating(false); setSending(false); setError("");
    setFailedDraft(null);
  }, [characterId]);
  // This ref tracks the active session for the reveal queue's async callbacks.
  const { queue: revealQueue, state: revealState } = useBubbleReveal(
    // eslint-disable-next-line react-hooks/refs
    currentSessionId.current, messages, session?.streamOnline === true, !!loadError,
  );
  function showFeedback(text: string) {
    feedbackController.show(text);
  }
  useEffect(() => () => feedbackController.cancel(), [feedbackController]);
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionStartId, setSelectionStartId] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [memoryMessage, setMemoryMessage] = useState<ChatMessage | null>(null);
  const [editText, setEditText] = useState("");
  const [chatInfoOpen, setChatInfoOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pendingSearchJumpId, setPendingSearchJumpId] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const history = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!isChatDiagnosticsEnabled()) return;
    const nodeCount = history.current?.querySelectorAll("[data-message-id]").length ?? 0;
    recordChatDiagnostic("chat-react-commit", { characterId, hasSession: !!session, messageCount: messages.length, nodeCount });
  }, [characterId, session, messages.length]);
  // Diagnostics only: when the shell turned into the published frame, to tell the route wait from the frame wait.
  const hasSession = !!session;
  useLayoutEffect(() => {
    if (isChatDiagnosticsEnabled()) recordChatDiagnostic("chat-frame", { characterId, phase: framePublished ? "published" : "shell", hasSession });
  }, [characterId, framePublished, hasSession]);
  const nearBottom = useRef<{ characterId: string; sessionId: string | undefined; value: boolean }>({
    characterId, sessionId: undefined, value: true,
  });
  const initialPositionedSession = useRef<string | null>(null);
  const previousSearchJumpId = useRef<string | null>(null);
  const mounted = useRef(true);
  const shell = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const composerBar = useRef<HTMLFormElement>(null);
  const chatInfoScreen = useRef<HTMLElement>(null);
  const confirmDialog = useRef<HTMLDivElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const overlayFocusOrigin = useRef(new Map<string, HTMLElement | null>());
  const previousOverlay = useRef<string | null>(null);
  const nativeSelectionActive = useRef(false);
  const { activeMessage, reactionPickerOpen, reactionBar, actionMenu, positionMenu, closeActions, openActions,
    confirmDelete, cancelDelete, deleteConfirmed, onPointerDownMessage, onContextMenuMessage,
    react: reactToMessage, copyMessage, recallActiveMessage, requestDelete, setReactionPickerOpen } = useMessageActions({
    shell, history, session: session?.characterId === characterId ? session : null,
    multiSelect, nativeSelectionActive, nearBottom, onCloseChatInfo: () => setChatInfoOpen(false), onError: setError,
    onFeedback: showFeedback, onDeleted: (ids) => { revealQueue.discard(ids); setMultiSelect(false); setSelectedIds(new Set()); } });
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
    let previous = bar.offsetHeight;
    const update = () => {
      const height = bar.offsetHeight, list = history.current;
      // A panel under the input row grows the composer, and the history's bottom padding grows with it. If the reader was at the
      // latest message, scroll along so it stays above the panel instead of ending up behind it.
      const atBottom = !!list && list.scrollHeight - list.scrollTop - list.clientHeight < 80 + Math.max(0, height - previous);
      shell.current?.style.setProperty("--chat-composer-height", `${height}px`);
      if (list && panelOpen.current && atBottom && height !== previous)
        requestAnimationFrame(() => list.scrollTo({ top: list.scrollHeight }));
      previous = height;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);
  const panelOpen = useRef(false);
  // Synchronize the panel visibility ref used by the composer resize observer.
  // eslint-disable-next-line react-hooks/immutability
  useEffect(() => { panelOpen.current = panel !== null; }, [panel]);
  const overlayKind = confirmDelete ? "confirm-delete" : confirmClear ? "confirm-clear" :
    chatInfoOpen ? "chat-info" : activeMessage ? "message-actions" : null;
  useLayoutEffect(() => {
    const previous = previousOverlay.current;
    if (overlayKind && overlayKind !== previous &&
      !(overlayKind === "chat-info" && overlayFocusOrigin.current.has("chat-info"))) {
      overlayFocusOrigin.current.set(overlayKind,
        globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null);
    }
    const getRoot = () => overlayKind === "chat-info" ? chatInfoScreen.current :
      overlayKind === "message-actions" ? actionMenu.current : confirmDialog.current;
    const root = getRoot();
    const focusables = (scope = getRoot()) => scope ? [...scope.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => !element.closest('[inert]') && element.getAttribute("aria-hidden") !== "true") : [];
    const focusFirst = () => {
      const currentRoot = getRoot();
      const target = overlayKind === "confirm-delete" || overlayKind === "confirm-clear"
        ? currentRoot?.querySelector<HTMLElement>('button:not(:disabled)')
        : focusables()[0];
      (target ?? currentRoot)?.focus({ preventScroll: true });
    };
    const canRestore = (element: HTMLElement | null | undefined) => !!element?.isConnected &&
      element !== globalThis.document.body && element !== globalThis.document.documentElement &&
      (element.tabIndex >= 0 || element.matches("button, input, textarea, select, a[href], [contenteditable=true]"));
    const inerted: Array<{ element: HTMLElement; wasInert: boolean }> = [];
    if (overlayKind && root && shell.current) {
      const allowed = new Set<Element | null>([overlayKind === "chat-info" ? root : root.parentElement]);
      for (const child of [...shell.current.children]) {
        // The message layer is several siblings (backdrop, reaction bar, picker, menu); none of them may be inert.
        if (overlayKind === "message-actions" ? child.hasAttribute("data-message-overlay") : allowed.has(child)) continue;
        const element = child as HTMLElement;
        inerted.push({ element, wasInert: element.hasAttribute("inert") });
        element.setAttribute("inert", "");
      }
      focusFirst();
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const currentRoot = getRoot();
      if (!currentRoot) return;
      if (event.key === "Escape") {
        const ElementConstructor = currentRoot.ownerDocument.defaultView?.Element;
        const target = ElementConstructor && event.target instanceof ElementConstructor ? event.target : null;
        const nestedDialog = target?.closest('dialog, [role="dialog"], [role="alertdialog"]');
        if (nestedDialog && nestedDialog !== currentRoot) return;
        event.preventDefault();
        event.stopPropagation();
        if (overlayKind === "chat-info") setChatInfoOpen(false);
        else if (overlayKind === "message-actions") closeActions();
        else if (overlayKind === "confirm-delete") cancelDelete();
        else if (overlayKind === "confirm-clear") setConfirmClear(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) { event.preventDefault(); currentRoot.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const index = items.indexOf(globalThis.document.activeElement as HTMLElement);
      event.preventDefault();
      if (event.shiftKey) (index <= 0 ? last : items[index - 1]).focus();
      else (index < 0 || index === items.length - 1 ? first : items[index + 1]).focus();
    };
    if (overlayKind && root) {
      globalThis.document.addEventListener("keydown", onKeyDown, true);
    }
    if (!overlayKind && previous) {
      const origin = overlayFocusOrigin.current.get(previous);
      const fallback = settingsTrigger.current?.isConnected ? settingsTrigger.current : composer.current;
      (canRestore(origin) && !origin!.closest("[inert]") ? origin : fallback)?.focus({ preventScroll: true });
      overlayFocusOrigin.current.delete(previous);
    } else if (overlayKind && previous && overlayKind !== previous) {
      const origin = overlayFocusOrigin.current.get(previous);
      if (canRestore(origin) && origin && root?.contains(origin)) origin.focus({ preventScroll: true });
    }
    previousOverlay.current = overlayKind;
    return () => {
      globalThis.document.removeEventListener("keydown", onKeyDown, true);
      for (const { element, wasInert } of inerted) {
        if (!wasInert) element.removeAttribute("inert");
      }
    };
  }, [overlayKind, closeActions, actionMenu, cancelDelete]);
  useLayoutEffect(() => {
    if (!framePublished || !session || initialPositionedSession.current === session.id) return;
    initialPositionedSession.current = session.id;
    if (!chatScrollIntentMatchesSession(nearBottom.current, session))
      nearBottom.current = { characterId: session.characterId, sessionId: session.id, value: true };
    if (shouldPositionChatHistoryAtBottom(nearBottom.current, session))
      history.current?.scrollTo({ top: history.current.scrollHeight });
  }, [framePublished, session?.id]);
  useEffect(() => {
    if (!framePublished) return;
    if (nearBottom.current.value)
      history.current?.scrollTo({ top: history.current.scrollHeight });
  // Publication-only changes are positioned by the layout effect above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, revealState]);
  useLayoutEffect(() => {
    if (!pendingSearchJumpId || previousSearchJumpId.current === pendingSearchJumpId) return;
    previousSearchJumpId.current = pendingSearchJumpId;
    const container = history.current;
    const target = container && Array.from(container.querySelectorAll<HTMLElement>("[data-message-id]"))
      .find((element) => element.dataset.messageId === pendingSearchJumpId);
    if (container && target) {
      nearBottom.current = { characterId, sessionId: currentSessionId.current, value: false };
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const centeredOffset = targetRect.top - containerRect.top - (container.clientHeight - targetRect.height) / 2;
      container.scrollTo({ top: container.scrollTop + centeredOffset, behavior: "smooth" });
      setHighlightedMessageId(pendingSearchJumpId);
      revealQueue.revealMessage(pendingSearchJumpId);
    }
    setPendingSearchJumpId(null);
  }, [pendingSearchJumpId, revealQueue]);
  // Preserve the original header safe area across keyboard transitions while
  // keeping keyboard panning confined to the composer and history bottom inset.
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
        if (nearBottom.current.value)
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
  // A sticker has no known size until its picture loads, so the list that scrolled to the new message ends up short of the
  // bottom once it does. While the reader is at the latest message, follow the picture's own growth.
  useEffect(() => {
    const list = history.current;
    if (!list) return;
    const follow = (event: Event) => {
      if (event.target instanceof HTMLImageElement && event.target.classList.contains("chat-sticker-image") && nearBottom.current.value)
        list.scrollTo({ top: list.scrollHeight });
    };
    // `load` does not bubble, so it is heard in the capture phase.
    list.addEventListener("load", follow, true);
    return () => list.removeEventListener("load", follow, true);
  }, [ready]);
  async function persistDraft(content: string, sessionId: string, focus: boolean, interject = false) {
    sendingLock.current = true;
    setSending(true);
    const editVersion = draftEditVersion.current;
    try {
      nearBottom.current = { characterId, sessionId, value: true };
      const quote = quotingMessage;
      await chatEngine.send(sessionId, content, quote?.id, { interject });
      if (mounted.current && currentSessionId.current === sessionId) {
        setQuotingMessage((current) => current?.id === quote?.id ? null : current);
        setDraft((current) => (current === content ? "" : current));
        if (focus) composer.current?.focus();
      } else if (mounted.current) {
        savedDraftAwaitingSession.current = { sessionId, content, editVersion };
      }
    } finally {
      const current = currentSessionId.current;
      if (mounted.current && (current === sessionId || current === undefined)) {
        sendingLock.current = false;
        setSending(false);
      }
    }
  }
  async function send() {
    if (!session || session.characterId !== characterId || sendingLock.current || !draft.trim() || loadError) return;
    // Life Mode: writing while the Character is still answering gives that unfinished answer up; it answers everything again.
    const interject = session.lifeMode === true && (generationActive || chatEngine.isGenerating(session.id));
    if (!interject && (generationActive || chatEngine.isGenerating(session.id))) return;
    const sessionId = session.id;
    setError("");
    setFailedDraft(null);
    try {
      await persistDraft(draft, sessionId, true, interject);
    } catch (e) {
      if (mounted.current && currentSessionId.current === sessionId)
        setError(
          e instanceof Error ? e.message : "Message could not be saved.",
        );
    }
  }
  async function sendSticker(sticker: MessageSticker) {
    if (!session || session.characterId !== characterId || sendingLock.current || loadError) return;
    const interject = session.lifeMode === true && (generationActive || chatEngine.isGenerating(session.id));
    if (!interject && (generationActive || chatEngine.isGenerating(session.id))) return;
    const sessionId = session.id, quote = quotingMessage;
    sendingLock.current = true;
    setSending(true);
    setError("");
    setPanel(null);
    try {
      nearBottom.current = { characterId, sessionId, value: true };
      await chatEngine.sendSticker(sessionId, sticker, quote?.id, { interject });
      if (mounted.current && currentSessionId.current === sessionId) setQuotingMessage((current) => current?.id === quote?.id ? null : current);
    } catch (e) {
      if (mounted.current && currentSessionId.current === sessionId) setError(e instanceof Error ? e.message : "表情包没有发出去。");
    } finally {
      const current = currentSessionId.current;
      if (mounted.current && (current === sessionId || current === undefined)) { sendingLock.current = false; setSending(false); }
    }
  }
  async function reply(source: "manual-reply" | "keyboard-auto-reply" = "manual-reply", retry?: NonNullable<typeof failedDraft>) {
    // Life Mode: the Character answers in its own time, so no button or setting asks for a reply right now.
    if (session?.lifeMode === true && session.characterId === characterId) { showFeedback(LIFE_MODE_NOTICE); return; }
    if (!session || session.characterId !== characterId || replyLock.current || sendingLock.current ||
      generationActive || chatEngine.isGenerating(session.id) || loadError) return;
    const sessionId = session.id;
    if (retry && retry.sessionId !== sessionId) return;
    const content = retry?.content ?? draft, quote = retry ? retry.quote : quotingMessage;
    const editVersion = retry?.editVersion ?? draftEditVersion.current;
    let saved = false;
    replyLock.current = true;
    let revealToken: number | undefined;
    setGenerating(true);
    setError("");
    setFailedDraft(null);
    nearBottom.current = { characterId, sessionId, value: true };
    try {
      revealToken = revealQueue.begin(sessionId, messages, session.streamOnline === true, performance.now(), bubbleTiming);
      const token = revealToken;
      await chatEngine.requestReply(sessionId, (completed) => {
        if (mounted.current && currentSessionId.current === sessionId)
          revealQueue.complete(sessionId, completed, performance.now(), token);
      }, source, { content, quoteMessageId: quote?.id, onSent: () => {
        saved = true;
        if (mounted.current && currentSessionId.current === sessionId) {
          if (draftEditVersion.current === editVersion) {
            setDraft((current) => current === content ? "" : current);
            setQuotingMessage((current) => current?.id === quote?.id ? null : current);
          }
        } else if (mounted.current) {
          savedDraftAwaitingSession.current = { sessionId, content, editVersion };
        }
      } });
    } catch (e) {
      if (mounted.current && currentSessionId.current === sessionId) {
        if (!saved && content.trim()) setFailedDraft({ sessionId, content, quote, editVersion });
        setError(
          e instanceof Error ? e.message : "Reply could not be requested.",
        );
      }
    } finally {
      revealQueue.settle(sessionId, revealToken);
      const current = currentSessionId.current;
      if (mounted.current && (current === sessionId || current === undefined)) {
        replyLock.current = false;
        setGenerating(false);
      }
    }
  }
  async function regenerate(message: ChatMessage, continuing = false) {
    if (!session || generationActive || sendingLock.current || revealState?.pending || replyLock.current || chatEngine.isGenerating(session.id)) return;
    const sessionId = session.id;
    replyLock.current = true;
    closeActions();
    setGenerating(true);
    nearBottom.current = { characterId, sessionId, value: true };
    const revealToken = revealQueue.begin(sessionId, messages, session.streamOnline === true, performance.now(), bubbleTiming);
    setError("");
    setFailedDraft(null);
    try {
      const action = continuing ? chatEngine.continueMessage : chatEngine.regenerateMessage;
      await action(message.id, (completed) => {
        if (mounted.current && currentSessionId.current === sessionId)
          revealQueue.complete(sessionId, completed, performance.now(), revealToken);
      }, sessionId);
    } catch (reason) {
      if (mounted.current && currentSessionId.current === sessionId)
        setError(reason instanceof Error ? reason.message : "Message could not be regenerated.");
    } finally {
      // Another session being current means a new room owns the locks; "no session" (switching, or a
      // transient reload) must still release them, or Regenerate stays blocked after the session returns.
      const current = currentSessionId.current;
      if (mounted.current && (current === sessionId || current === undefined)) {
        replyLock.current = false;
        revealQueue.settle(sessionId, revealToken);
        setGenerating(false);
      }
    }
  }
  useKeyboardDismissAutoReply(shell, {
    sessionId: session?.characterId === characterId ? session.id : undefined,
    enabled: session?.autoReplyOnKeyboardDismiss === true,
    blocked: generationActive || !!revealState?.pending || sending || multiSelect || !!activeMessage || !!editingMessage ||
      chatInfoOpen || confirmClear || !!confirmDelete,
    onReply: () => reply("keyboard-auto-reply"),
  });
  async function updateSetting(patch: {
    streamOnline?: boolean;
    autoReplyOnKeyboardDismiss?: boolean;
    lifeMode?: boolean;
    pinned?: boolean;
    backgroundImage?: string | null;
    backgroundBlur?: number | null;
  }) {
    if (!session) return;
    await chatStorage.updateSessionSettings(session.id, patch);
  }
  const loadingNotice = chatLoadingNotice(ready, !!character, loadError);
  if (!ready || !character)
    return (
      <div className="chat-app chat-room chat-room-wrapper" ref={shell}>
        <ChatHeader key="header" contact={null} settingsTrigger={settingsTrigger} />
        <div key="history" className="chat-history chat-scroll-anchored" ref={history}
          aria-label="Conversation history" aria-busy={!ready}>
          <p className="chat-notice" role="status">{loadingNotice}</p>
        </div>
        <form key="composer" className="chat-composer chat-input-bar" ref={composerBar}>
          <button type="button" className="chat-composer-icon chat-composer-plus" aria-label="More message options" disabled>
            <Plus aria-hidden="true" />
          </button>
          <div className="chat-input-shell">
            <label className="chat-input-label" htmlFor="chat-input">Message</label>
            <textarea id="chat-input" className="chat-input-textarea" ref={composer}
              rows={1} value="" readOnly disabled placeholder="Message…" />
            <span className="chat-voice-slot" aria-hidden="true" />
          </div>
          <div className="chat-composer-actions chat-input-actions">
            <button type="button" className="chat-composer-icon chat-request-reply" aria-label="Request Reply" disabled>
              <Sparkles aria-hidden="true" />
            </button>
            <button type="button" className="chat-composer-icon chat-send" aria-label="Send" disabled>
              <SendHorizontal aria-hidden="true" />
            </button>
          </div>
        </form>
      </div>
    );
  const pending = hasPendingUserContent(messages);
  const selectable = messages.filter((message) => message.status !== "streaming");
  const hidden = (message: ChatMessage) =>
    (message.id !== pendingSearchJumpId && !!revealState && hiddenForReveal(message, revealState)) ||
    (generationActive && session?.streamOnline !== true && message.role === "assistant" && message.status === "streaming");
  const visibleMessages = messages.filter((message) => !hidden(message));
  const groupedMessages = groupVisibleMessages(visibleMessages);
  const lastVisibleMessageId = groupedMessages.findLast(({ message }) => message.role !== "system")?.message.id;
  const typing = !!revealState?.pending || (generationActive && session?.streamOnline !== true);
  const firstHiddenIndex = messages.findIndex(hidden);
  const typingBeforeId = firstHiddenIndex < 0 ? undefined :
    messages.slice(firstHiddenIndex + 1).find((message) => !hidden(message))?.id;
  const typingIndicator = framePublished && typing && <div className="chat-turn chat-turn-assistant chat-msg-wrapper" role="status" aria-label="Typing">
    <div className="chat-avatar-column chat-msg-avatar"><ChatAvatar profile={character} /></div><div className="chat-message">
      <p className="chat-bubble chat-bubble-role-assistant"><span className="chat-typing-dots" aria-hidden="true"><i /><i /><i /></span></p>
    </div>
  </div>;
  return (
    <div className="chat-app chat-room chat-room-wrapper" ref={shell}
      style={framePublished && chatBackground.url ? {
        "--chat-background-image": `url(${JSON.stringify(chatBackground.url)})`,
        "--chat-background-blur": `${chatBackground.blur}px`,
        "--chat-background-inset": chatBackground.blur ? `${-2 * chatBackground.blur}px` : "0px",
      } as CSSProperties : undefined}
      data-chat-background={framePublished && chatBackground.url ? "custom" : "default"}
      data-chat-background-entry={framePublished && chatBackground.url && chatBackground.late ? "fade" : undefined}
      data-context-menu-open={activeMessage ? "" : undefined}>
      {framePublished && session?.customCSS && <SessionCustomCSS css={session.customCSS} />}
      <ChatHeader key="header" settingsTrigger={settingsTrigger} presence={presence.ready ? presence.status : undefined} generating={generationActive}
        contact={framePublished ? { characterId: character.characterId, name: contactName, profile: character } : null}
        onOpenSettings={() => {
          overlayFocusOrigin.current.set("chat-info",
            globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null);
          setChatInfoOpen(true);
        }} />
      <div
        key="history"
        className={`chat-history chat-scroll-anchored${empty ? " chat-history-empty" : ""}`}
        ref={history}
        aria-label="Conversation history"
        aria-busy={!framePublished}
        onScroll={() => {
          const el = history.current;
          if (el)
            nearBottom.current = {
              characterId,
              sessionId: currentSessionId.current,
              value: el.scrollHeight - el.scrollTop - el.clientHeight < 80,
            };
          if (activeMessage) positionMenu.current();
        }}
      >
        {!framePublished && loadingNotice && <p className="chat-notice" role="status">{loadingNotice}</p>}
        {empty && <p className="chat-empty-state">No messages yet</p>}
        {framePublished && <MessageList
          groupedMessages={groupedMessages}
          messages={messages}
          selectedIds={selectedIds}
          activeMessageId={activeMessage?.id}
          highlightedMessageId={highlightedMessageId}
          multiSelect={multiSelect}
          typing={typing}
          typingBeforeId={typingBeforeId}
          typingIndicator={typingIndicator}
          character={character}
          userName={document.user.name}
          streamOnline={session?.streamOnline === true}
          generationActive={generationActive}
          regexGroups={regexGroups}
          lastVisibleMessageId={lastVisibleMessageId}
          lifeMode={session?.lifeMode === true}
          onOpenActions={openActions}
          onToggleSelected={(message) => setSelectedIds((current) => { const next = new Set(current);
            if (next.has(message.id)) next.delete(message.id); else next.add(message.id); return next; })}
          onClearHighlight={() => setHighlightedMessageId(null)}
          onRegenerate={(message, continuation) => void regenerate(message, continuation)}
          onPointerDownMessage={onPointerDownMessage}
          onContextMenuMessage={onContextMenuMessage}
          onTransferAction={(id, action) => void transfers.act(id, action)}
          onGiftAction={(id, action) => void gifts.act(id, action)}
        />}
      </div>
      {(error || loadError) && (
        <p role="alert" className="chat-notice chat-error">
          {error || loadError}
          {/* Keep retries scoped to the session that produced the saved draft. */}
          {/* eslint-disable-next-line react-hooks/refs */}
          {failedDraft?.sessionId === currentSessionId.current && failedDraft && <button type="button"
            aria-label="Retry draft" disabled={generationActive || sending || !!loadError}
            onClick={() => void reply("manual-reply", failedDraft)}>Retry</button>}
        </p>
      )}
      {feedback && <div className="chat-feedback-toast" role="status">{feedback}</div>}
      {multiSelect && <ChatMultiSelectBar selectedCount={selectedIds.size} canSelectFromHere={!!selectionStartId}
        onSelectAll={() => setSelectedIds(new Set(selectable.map((m) => m.id)))}
        onSelectFromHere={() => selectionStartId &&
          setSelectedIds(new Set(selectMessageRange(selectable.map((m) => m.id), selectionStartId)))}
        onDelete={() => requestDelete([...selectedIds])}
        onCancel={() => { setMultiSelect(false); setSelectedIds(new Set()); }} />}
      {panel && <button type="button" className="chat-tray-backdrop" aria-label="Close panel" onClick={() => setPanel(null)} />}
      {stickerManagerOpen && <StickerManager
        characters={document.characters.map((item) => ({ characterId: item.characterId, name: item.name }))}
        current={{ characterId: character.characterId, name: character.name }}
        onClose={() => setStickerManagerOpen(false)} />}
      <form
        key="composer"
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
          aria-label="More message options" title="More message options" aria-expanded={panel !== null}
          onClick={() => { composer.current?.blur(); setPanel((current) => current === null ? "plus" : null); }}>
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
            onChange={(e) => { draftEditVersion.current += 1; setDraft(e.target.value); }}
          />
          <span className="chat-voice-slot" aria-hidden="true" />
        </div>
        <div className="chat-composer-actions chat-input-actions">
          {generationActive || revealState?.pending ? (
            <button type="button" className="chat-composer-icon" aria-label="Stop reply" title="Stop reply"
              onClick={() => {
                revealQueue.cancel();
                if (session) chatEngine.stop(session.id, { persist: true });
              }}>
              <Square aria-hidden="true" />
            </button>
          ) : session?.autoReplyOnKeyboardDismiss !== true && session?.lifeMode !== true ? (
            <button
              type="button"
              className="chat-composer-icon chat-request-reply"
              aria-label="Request Reply"
              title="Request Reply"
              onPointerDown={(e) => e.preventDefault()}
              disabled={!session || (session.lifeMode !== true && !pending && !draft.trim()) || sending || !!loadError}
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
            disabled={!session || (generationActive && session.lifeMode !== true) || sending || !draft.trim() || !!loadError}
          >
            <SendHorizontal aria-hidden="true" />
          </button>
        </div>
        {panel === "plus" && <ChatPlusPanel onStickers={() => setPanel("stickers")} onTransfer={() => { setPanel(null); transfers.setComposerOpen(true); }}
          onGift={() => { setPanel(null); gifts.setComposerOpen(true); }} />}
        {panel === "stickers" && <StickerPanel disabled={(generationActive && session?.lifeMode !== true) || sending || !!loadError} onSend={(sticker) => void sendSticker(sticker)}
          onManage={() => { setPanel(null); setStickerManagerOpen(true); }} />}
      </form>
      {transfers.composerOpen && <TransferComposer disabled={transfers.working || generationActive || !!loadError}
        onClose={() => transfers.setComposerOpen(false)} onSend={(amount, note) => void transfers.send(amount, note)} />}
      {gifts.composerOpen && <GiftComposer disabled={gifts.working || generationActive || !!loadError}
        onClose={() => gifts.setComposerOpen(false)} onSend={(icon, content) => void gifts.send(icon, content)} />}
      {chatInfoOpen && <ChatInfoScreen
        screenRef={chatInfoScreen}
        session={session}
        messages={messages}
        characterName={contactName}
        character={character}
        streamOnline={session?.streamOnline === true}
        autoReplyOnKeyboardDismiss={session?.autoReplyOnKeyboardDismiss === true}
        lifeMode={session?.lifeMode === true}
        pinned={session?.pinned === true}
        canClear={messages.length > 0 && !generationActive}
        onBack={() => setChatInfoOpen(false)}
        onJumpToMessage={(messageId) => {
          nearBottom.current = { characterId, sessionId: currentSessionId.current, value: false };
          previousSearchJumpId.current = null;
          setPendingSearchJumpId(messageId);
          setChatInfoOpen(false);
        }}
        onUpdate={updateSetting}
        onClear={() => setConfirmClear(true)}
      />}
      <MessageActionsOverlay activeMessage={activeMessage} messages={messages} generationActive={generationActive}
        revealPending={!!revealState?.pending} actionMenuRef={actionMenu} reactionBarRef={reactionBar}
        reactionPickerOpen={reactionPickerOpen} onClose={closeActions}
        onPickReaction={(emoji) => { void reactToMessage(emoji); }}
        onOpenReactionPicker={() => setReactionPickerOpen(true)} onCopy={() => void copyMessage()}
        onEdit={() => { if (!activeMessage) return; setEditingMessage(activeMessage); setEditText(activeMessage.content); closeActions(); }}
        onQuote={() => { if (!activeMessage) return; setQuotingMessage(activeMessage); closeActions(); composer.current?.focus(); }}
        onMemory={() => { if (!activeMessage) return; setMemoryMessage(activeMessage); closeActions(); }}
        onSelect={() => { if (!activeMessage) return; setMultiSelect(true); setSelectionStartId(activeMessage.id); setSelectedIds(new Set([activeMessage.id])); closeActions(); }}
        onDelete={() => { if (!activeMessage) return; requestDelete([activeMessage.id], true); }}
        onRegenerate={() => { if (activeMessage) void regenerate(activeMessage); }} onRecall={() => void recallActiveMessage()}
        onRunRegisteredAction={(id) => {
          if (!activeMessage) return;
          const message = activeMessage;
          closeActions();
          void runMessageAction(id, message, {
            updateMessage: (patch) => chatStorage.editMessage(message.id, patch.content), toast: showFeedback,
          }).catch((reason) => setError(reason instanceof Error ? reason.message : "Message action failed."));
        }} />
      {memoryMessage && <MessageMemory key={memoryMessage.id} message={memoryMessage} characterId={characterId} onClose={() => setMemoryMessage(null)} />}
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
      {confirmDelete && <ConfirmDialog dialogRef={confirmDialog} title="Delete messages?"
        text={`Delete ${confirmDelete.length} message${confirmDelete.length === 1 ? "" : "s"} from this conversation?`}
        onCancel={cancelDelete} onConfirm={() => void deleteConfirmed()} />}
      {confirmClear && <ConfirmDialog dialogRef={confirmDialog} title="Clear Chat History?"
        text={`Delete all ${messages.length} messages from this conversation? The conversation itself will remain.`}
        onCancel={() => setConfirmClear(false)} onConfirm={async () => {
          if (!session) return;
          try {
            const { cleanupIncomplete } = await withMemoryClear(session, (scope) => chatStorage.clearSession(session.id, scope));
            revealQueue.cancel(); setConfirmClear(false);
            showFeedback(cleanupIncomplete ? "Conversation cleared. Memory cleanup is pending." : "Conversation cleared");
          }
          catch (reason) { setError(reason instanceof Error ? reason.message : "Conversation could not be cleared."); }
        }} />}
    </div>
  );
}

function ChatInfoScreen({ screenRef, session, messages, characterName, character, streamOnline, autoReplyOnKeyboardDismiss, lifeMode, pinned,
  canClear, onBack, onJumpToMessage, onUpdate, onClear }: {
  screenRef: React.Ref<HTMLElement>;
  session: ChatSession | null;
  messages: ChatMessage[];
  characterName: string;
  character: { characterId: string; name: string; timezone: string | null } | undefined;
  streamOnline: boolean;
  autoReplyOnKeyboardDismiss: boolean;
  lifeMode: boolean;
  pinned: boolean;
  canClear: boolean;
  onBack: () => void;
  onJumpToMessage: (messageId: string) => void;
  onUpdate: (patch: {
    streamOnline?: boolean;
    autoReplyOnKeyboardDismiss?: boolean;
    lifeMode?: boolean;
    pinned?: boolean;
  }) => Promise<void>;
  onClear: () => void;
}) {
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [customCSSOpen, setCustomCSSOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [lifeOpen, setLifeOpen] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const settingsScreenMounted = useRef(false);
  const settingsUpdateRevision = useRef(0);
  useEffect(() => {
    settingsScreenMounted.current = true;
    return () => { settingsScreenMounted.current = false; };
  }, []);
  async function updateSettings(patch: {
    streamOnline?: boolean;
    autoReplyOnKeyboardDismiss?: boolean;
    lifeMode?: boolean;
    pinned?: boolean;
  }) {
    const revision = ++settingsUpdateRevision.current;
    setSettingsError("");
    try {
      await onUpdate(patch);
    } catch (reason) {
      if (settingsScreenMounted.current && revision === settingsUpdateRevision.current)
        setSettingsError(reason instanceof Error ? reason.message : "Setting could not be saved.");
    }
  }
  useLayoutEffect(() => {
    const screen = typeof screenRef === "function" ? null : screenRef?.current;
    screen?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled)")
      ?.focus({ preventScroll: true });
  }, [backgroundOpen, customCSSOpen, searchOpen, lifeOpen, screenRef]);
  if (backgroundOpen && session)
    return <ChatBackgroundSettings screenRef={screenRef} session={session} onBack={() => setBackgroundOpen(false)} />;
  if (customCSSOpen && session)
    return <CustomCSSSettings screenRef={screenRef} session={session} onBack={() => setCustomCSSOpen(false)} />;
  if (searchOpen) return <ChatHistorySearchPage screenRef={screenRef} sessionId={session?.id ?? ""} messages={messages}
    characterName={characterName} onBack={() => setSearchOpen(false)} onJumpToMessage={onJumpToMessage} />;
  if (lifeOpen && character) return <LifeTimelineScreen screenRef={screenRef} character={character} onBack={() => setLifeOpen(false)} />;
  return <section ref={screenRef} className="chat-info-screen" role="dialog" aria-modal="true" aria-label="Chat Info">
    <header className="chat-info-header">
      <button type="button" className="chat-info-back" aria-label="Back to conversation" onClick={onBack}>
        <ChevronLeft aria-hidden="true" />
      </button>
      <h1>Chat Info</h1>
      <span className="chat-info-header-spacer" aria-hidden="true" />
    </header>
    <div className="chat-info-body">
      {settingsError && <p role="alert" className="chat-notice chat-setting-error">{settingsError}</p>}
      <section className="chat-info-group" aria-label="Chat history">
        <button type="button" className="chat-session-setting chat-info-row"
          onClick={() => setSearchOpen(true)}>
          <span>Search Chat History</span><ChevronRight aria-hidden="true" />
        </button>
      </section>
      <section className="chat-info-group" aria-label="Character life">
        <button type="button" className="chat-session-setting chat-info-row" disabled={!character}
          onClick={() => setLifeOpen(true)}>
          <span>Life<small>See what {characterName || "this Character"} has been doing.</small></span><ChevronRight aria-hidden="true" />
        </button>
      </section>
      <section className="chat-info-group" aria-label="Conversation settings">
        <label className="chat-session-setting chat-info-toggle"><span>Pin Conversation</span>
          <Switch checked={pinned} disabled={!session}
            onChange={(checked) => void updateSettings({ pinned: checked })} /></label>
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
          <Switch checked={streamOnline} disabled={!session}
            onChange={(checked) => void updateSettings({ streamOnline: checked })} /></label>
        <label className="chat-session-setting chat-info-toggle"><span>Life Mode
          <small>{lifeMode ? "Just send. They answer in their own time; if they are away too long, your message waits. Turn off, then Request Reply, to get an answer now."
            : "Just send messages; they reply on their own rhythm instead of at once."}</small></span>
          <Switch checked={lifeMode} disabled={!session || session.type === "group"}
            onChange={(checked) => void updateSettings({ lifeMode: checked })} /></label>
        <label className="chat-session-setting chat-info-toggle"><span>Reply When Keyboard Closes
          {lifeMode && <small>Not used while Life Mode is on.</small>}</span>
          <Switch checked={autoReplyOnKeyboardDismiss} disabled={!session || lifeMode}
            onChange={(checked) => void updateSettings({ autoReplyOnKeyboardDismiss: checked })} /></label>
      </section>
      <section className="chat-info-group chat-info-danger-group" aria-label="Danger">
        <button type="button" className="chat-session-setting chat-info-clear chat-danger"
          disabled={!canClear} onClick={onClear}>Clear Chat History</button>
      </section>
    </div>
  </section>;
}

function ChatHistorySearchPage({ screenRef, sessionId, messages, characterName, onBack, onJumpToMessage }: {
  screenRef: React.Ref<HTMLElement>;
  sessionId: string;
  messages: ChatMessage[];
  characterName: string;
  onBack: () => void;
  onJumpToMessage: (messageId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [searchResult, setSearchResult] = useState<{ query: string; messages: ChatMessage[] } | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || !sessionId) return;
    const controller = new AbortController();
    void searchConversationMessages(messages, sessionId, trimmed, controller.signal)
      .then((matches) => { if (!controller.signal.aborted) setSearchResult({ query: trimmed, messages: matches }); });
    return () => controller.abort();
  }, [messages, query, sessionId]);
  const trimmedQuery = query.trim();
  const results = searchResult?.query === trimmedQuery ? searchResult.messages : [];
  const searching = !!trimmedQuery && searchResult?.query !== trimmedQuery;
  return <section ref={screenRef} className="chat-info-screen" role="dialog" aria-modal="true" aria-label="Search Chat History">
    <header className="chat-info-header">
      <button type="button" className="chat-info-back" aria-label="Back to Chat Info" onClick={onBack}>
        <ChevronLeft aria-hidden="true" />
      </button>
      <h1>Search Chat History</h1>
      <span className="chat-info-header-spacer" aria-hidden="true" />
    </header>
    <div className="chat-info-body">
      <label className="chat-history-search-field"><Search aria-hidden="true" />
        <input ref={searchInput} type="search" aria-label="Search messages in this conversation"
          placeholder="Search messages" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      {!query.trim() ? <p className="chat-info-search-unavailable">Search messages in this conversation.</p> :
        searching ? <p className="chat-info-search-unavailable" role="status">Searching…</p> : results.length === 0 ?
          <p className="chat-info-search-unavailable" role="status">No messages found.</p> : <div className="chat-history-search-results">
            {results.map((message) => <button key={message.id} type="button" className="chat-history-search-result"
              onClick={() => { searchInput.current?.blur(); onJumpToMessage(message.id); }}>
              <span className="chat-history-search-result-heading">
                <strong>{message.role === "user" ? "Me" : characterName}</strong>
                <time dateTime={new Date(message.createdAt).toISOString()}>
                  {new Date(message.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </time>
              </span>
              <span className="chat-history-search-result-text">{message.content.trim().slice(0, 220)}</span>
            </button>)}
            {results.length === SEARCH_RESULT_LIMIT && <p className="chat-info-search-unavailable">
              Showing up to {SEARCH_RESULT_LIMIT} most recent matches.</p>}
          </div>}
    </div>
  </section>;
}

function ConfirmDialog({ dialogRef, title, text, onCancel, onConfirm }: {
  dialogRef: React.Ref<HTMLDivElement>;
  title: string; text: string; onCancel: () => void; onConfirm: () => void;
}) {
  return <div className="chat-dialog-backdrop"><div ref={dialogRef} tabIndex={-1} className="chat-dialog" role="alertdialog"
    aria-modal="true" aria-labelledby="chat-confirm-title"><h2 id="chat-confirm-title">{title}</h2>
    <p>{text}</p><div><button type="button" onClick={onCancel}>Cancel</button>
      <button type="button" className="chat-danger" onClick={onConfirm}>Delete</button></div></div></div>;
}


