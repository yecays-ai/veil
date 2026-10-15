"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

type TransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => { finished: Promise<void> };
};
const PRIVATE_CHAT = /^\/messages\/[^/]+$/;
const isMessagesRoute = (path: string) => path === "/messages" || PRIVATE_CHAT.test(path);

// A private chat counts as arrived once its history is published and positioned, so the slide never shows the empty shell.
function routeArrived(path: string) {
  const frame = document.querySelector<HTMLElement>("[data-messages-route]");
  if (frame?.dataset.messagesRoute !== path) return false;
  return !PRIVATE_CHAT.test(path) || !!frame.querySelector(".chat-room[data-chat-ready]");
}

// The chat page gives up on a slow wallpaper after 1200 ms and then publishes without it; the slide must wait at least that long.
const ARRIVAL_LIMIT_MS = 1500;

function waitForRoute(path: string, previous: string) {
  return new Promise<void>((resolve) => {
    if (path !== previous && routeArrived(path)) { resolve(); return; }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      observer.disconnect();
      window.clearTimeout(timeout);
      resolve();
    };
    const observer = new MutationObserver(() => { if (routeArrived(path)) finish(); });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-messages-route", "data-chat-ready"] });
    const timeout = window.setTimeout(finish, ARRIVAL_LIMIT_MS);
  });
}

// Next calls a Link's onNavigate only for a plain same-tab navigation that the Link's own onClick did not cancel
// (the Chats row cancels the click that ends a swipe), so a capturing document click listener is not used.
const MessagesNavigationContext = createContext<(href: string) => boolean>(() => false);

/** Returns a Link `onNavigate` that slides Chats <-> chat. Without view-transition support it leaves navigation to the Link. */
export function useMessagesNavigation() {
  const navigate = useContext(MessagesNavigationContext);
  return (href: string) => (event: { preventDefault: () => void }) => { if (navigate(href)) event.preventDefault(); };
}

export function MessagesRouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const currentPath = useRef(pathname);
  const transitionId = useRef(0);
  useLayoutEffect(() => { currentPath.current = pathname; }, [pathname]);

  const navigate = useCallback((href: string) => {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname === currentPath.current) return false;
    const direction = PRIVATE_CHAT.test(url.pathname) ? "forward"
      : url.pathname === "/messages" && PRIVATE_CHAT.test(currentPath.current) ? "back" : null;
    const start = (document as TransitionDocument).startViewTransition;
    if (!direction || !isMessagesRoute(url.pathname) || !start || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    const previous = currentPath.current;
    const id = ++transitionId.current;
    document.documentElement.dataset.messagesNav = direction;
    const transition = start.call(document, async () => {
      router.push(url.pathname + url.search + url.hash);
      await waitForRoute(url.pathname, previous);
    });
    void transition.finished.catch(() => {}).finally(() => {
      if (transitionId.current === id) delete document.documentElement.dataset.messagesNav;
    });
    return true;
  }, [router]);

  return <MessagesNavigationContext.Provider value={navigate}>
    <div className="messages-route-frame" data-messages-route={pathname}>{children}</div>
  </MessagesNavigationContext.Provider>;
}
