"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
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
    const timeout = window.setTimeout(finish, 900);
  });
}

export function MessagesRouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const currentPath = useRef(pathname);
  const transitionId = useRef(0);
  useLayoutEffect(() => { currentPath.current = pathname; }, [pathname]);

  useEffect(() => {
    const begin = (direction: "forward" | "back", update: () => void | Promise<void>) => {
      const start = (document as TransitionDocument).startViewTransition;
      if (!start || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { void update(); return; }
      const id = ++transitionId.current;
      document.documentElement.dataset.messagesNav = direction;
      const transition = start.call(document, update);
      void transition.finished.catch(() => {}).finally(() => {
        if (transitionId.current === id) delete document.documentElement.dataset.messagesNav;
      });
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target && link.target !== "_self" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === currentPath.current) return;
      const direction = PRIVATE_CHAT.test(url.pathname) ? "forward"
        : url.pathname === "/messages" && PRIVATE_CHAT.test(currentPath.current) ? "back" : null;
      if (!direction || !isMessagesRoute(url.pathname)) return;
      const start = (document as TransitionDocument).startViewTransition;
      if (!start || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      event.preventDefault();
      const previous = currentPath.current;
      begin(direction, async () => {
        router.push(url.pathname + url.search + url.hash);
        await waitForRoute(url.pathname, previous);
      });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);

  return <div className="messages-route-frame" data-messages-route={pathname}>{children}</div>;
}
