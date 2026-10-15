"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { chatStorage } from "../../../lib/chat/storage";
import type { ChatMessage, ChatSession } from "../../../lib/chat/types";
import { MESSAGE_MENU_GAP_PX, messageMenuPosition, messageStackShift, reactionBarLeft } from "../../../lib/chat/message-actions";

type NearBottom = { current: { value: boolean } };

/** Owns message action state, persistence and anchored overlay positioning. ChatRoom supplies session coordination. */
export function useMessageActions({ shell, history, session, multiSelect, nativeSelectionActive, nearBottom,
  onCloseChatInfo, onError, onFeedback, onDeleted }: {
  shell: RefObject<HTMLDivElement | null>;
  history: RefObject<HTMLDivElement | null>;
  session: ChatSession | null;
  multiSelect: boolean;
  nativeSelectionActive: RefObject<boolean>;
  nearBottom: NearBottom;
  onCloseChatInfo: () => void;
  onError: (message: string) => void;
  onFeedback: (message: string) => void;
  onDeleted: (ids: string[]) => void;
}) {
  const [activeMessage, setActiveMessage] = useState<ChatMessage | null>(null);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const reactionBar = useRef<HTMLDivElement>(null);
  const actionMenu = useRef<HTMLDivElement>(null);
  const positionMenu = useRef<() => void>(() => {});

  const closeActions = useCallback(() => {
    setActiveMessage(null);
    setMenuAnchor(null);
    setReactionPickerOpen(false);
  }, []);

  useEffect(() => {
    const trackSelection = () => {
      const selection = window.getSelection();
      nativeSelectionActive.current = !!selection && !selection.isCollapsed && !!selection.toString();
    };
    globalThis.document.addEventListener("selectionchange", trackSelection);
    return () => globalThis.document.removeEventListener("selectionchange", trackSelection);
  }, [nativeSelectionActive]);

  useLayoutEffect(() => {
    if (!activeMessage || !menuAnchor || !actionMenu.current || !shell.current) return;
    const menu = actionMenu.current, bar = reactionBar.current, scroller = history.current, root = shell.current;
    const measure = () => {
      const viewportRect = root.getBoundingClientRect();
      const scaleX = viewportRect.width / root.clientWidth || 1;
      const scaleY = viewportRect.height / root.clientHeight || 1;
      const rect = menuAnchor.getBoundingClientRect();
      return {
        bubble: { left: (rect.left - viewportRect.left) / scaleX, right: (rect.right - viewportRect.left) / scaleX,
          top: (rect.top - viewportRect.top) / scaleY, bottom: (rect.bottom - viewportRect.top) / scaleY },
        viewport: { width: root.clientWidth, height: root.clientHeight },
      };
    };
    const menuHeight = () => menu.scrollHeight + menu.offsetHeight - menu.clientHeight;
    const wasNearBottom = nearBottom.current.value;
    let restoreScroll = () => {};
    if (bar && scroller) {
      const { bubble, viewport } = measure();
      const shift = messageStackShift(bubble, { height: bar.offsetHeight }, { height: menuHeight() },
        { height: viewport.height, safeTop: parseFloat(getComputedStyle(scroller).paddingTop) || 0 });
      if (shift) {
        const wanted = scroller.scrollTop - shift;
        const room = wanted - (scroller.scrollHeight - scroller.clientHeight);
        if (room > 0) scroller.style.paddingBottom = `${(parseFloat(getComputedStyle(scroller).paddingBottom) || 0) + room}px`;
        scroller.scrollTop = wanted;
        restoreScroll = () => {
          scroller.style.paddingBottom = "";
          if (wasNearBottom) scroller.scrollTop = scroller.scrollHeight;
        };
      }
    }
    const position = () => {
      if (!menu.isConnected || !menuAnchor.isConnected) return;
      const { bubble, viewport } = measure();
      menu.style.maxWidth = `${Math.max(0, viewport.width - 16)}px`;
      const size = { width: menu.offsetWidth, height: menuHeight() };
      if (bar) {
        const menuTop = Math.min(bubble.bottom + MESSAGE_MENU_GAP_PX, Math.max(viewport.height - 8 - size.height, 8));
        Object.assign(bar.style, { left: `${reactionBarLeft(bubble, bar.offsetWidth, viewport.width, activeMessage.role)}px`,
          top: `${bubble.top - MESSAGE_MENU_GAP_PX - bar.offsetHeight}px`, visibility: "visible" });
        Object.assign(menu.style, { left: `${messageMenuPosition(bubble, size, viewport).left}px`, top: `${menuTop}px`,
          maxHeight: `${Math.max(0, viewport.height - 8 - menuTop)}px`, visibility: "visible" });
        return;
      }
      const result = messageMenuPosition(bubble, size, viewport);
      Object.assign(menu.style, { left: `${result.left}px`, top: `${result.top}px`, maxHeight: `${result.maxHeight}px`, visibility: "visible" });
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
      restoreScroll();
    };
  }, [activeMessage, menuAnchor, history, nearBottom, shell]);

  const openActions = useCallback((event: MouseEvent<HTMLElement>, message: ChatMessage) => {
    if (multiSelect || message.status === "streaming" || message.recalled) return;
    const selection = window.getSelection();
    if (nativeSelectionActive.current || (selection && !selection.isCollapsed && selection.toString())) return;
    setActiveMessage(message);
    setMenuAnchor(event.currentTarget);
    onCloseChatInfo();
  }, [multiSelect, nativeSelectionActive, onCloseChatInfo]);

  const react = useCallback(async (emoji: string | null) => {
    const message = activeMessage;
    if (!message) return;
    closeActions();
    try { await chatStorage.setReaction(message.id, "user", emoji); }
    catch (reason) { onError(reason instanceof Error ? reason.message : "Reaction could not be saved."); }
  }, [activeMessage, closeActions, onError]);

  const copyMessage = useCallback(async () => {
    if (!activeMessage) return;
    try { await navigator.clipboard.writeText(activeMessage.content); onFeedback("Copied"); }
    catch { onError("Message could not be copied."); }
    closeActions();
  }, [activeMessage, closeActions, onError, onFeedback]);

  const recallActiveMessage = useCallback(async () => {
    if (!activeMessage || activeMessage.role !== "user") return;
    const message = activeMessage;
    closeActions();
    try { await chatStorage.recallMessage(message.id, "user", undefined, session?.id); onFeedback("Message recalled"); }
    catch (reason) { onError(reason instanceof Error ? reason.message : "Message could not be recalled."); }
  }, [activeMessage, closeActions, onError, onFeedback, session?.id]);

  const requestDelete = useCallback((ids: readonly string[], closeMenu = false) => {
    if (!ids.length) return;
    setConfirmDelete([...ids]);
    if (closeMenu) closeActions();
  }, [closeActions]);
  const cancelDelete = useCallback(() => setConfirmDelete(null), []);
  const deleteConfirmed = useCallback(async () => {
    if (!session || !confirmDelete) return;
    try {
      await chatStorage.deleteMessages(session.id, confirmDelete);
      onDeleted(confirmDelete);
      onFeedback("Deleted");
      setConfirmDelete(null);
    } catch (reason) { onError(reason instanceof Error ? reason.message : "Messages could not be deleted."); }
  }, [confirmDelete, onDeleted, onError, onFeedback, session]);

  return {
    activeMessage, setActiveMessage, reactionPickerOpen, setReactionPickerOpen, reactionBar, actionMenu,
    positionMenu, closeActions, openActions, react, copyMessage, recallActiveMessage, requestDelete,
    confirmDelete, cancelDelete, deleteConfirmed,
    onPointerDownMessage: () => { nativeSelectionActive.current = false; },
    onContextMenuMessage: () => { nativeSelectionActive.current = true; },
  };
}
