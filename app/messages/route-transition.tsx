"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

type TransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => { finished: Promise<void> };
};
const PRIVATE_CHAT = /^\/messages\/[^/]+$/;
const isMessagesRoute = (path: string) => path === "/messages" || PRIVATE_CHAT.test(path);

function waitForRoute(path: string, previous: string) {
  return new Promise<void>((resolve) => {
    const frame = document.querySelector<HTMLElement>("[data-messages-route]");
    if (frame?.dataset.messagesRoute === path && path !== previous) { resolve(); return; }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      observer.disconnect();
      window.clearTimeout(timeout);
      resolve();
    };
    const observer = new MutationObserver(() => {
      if (document.querySelector<HTMLElement>("[data-messages-route]")?.dataset.messagesRoute === path) finish();
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-messages-route"] });
    const timeout = window.setTimeout(finish, 900);
  });
}

export function MessagesRouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const currentPath = useRef(pathname);
  const transitionId = useRef(0);
  currentPath.current = pathname;

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
      if (url.origin !== window.location.origin || !PRIVATE_CHAT.test(url.pathname) || url.pathname === currentPath.current) return;
      const start = (document as TransitionDocument).startViewTransition;
      if (!start || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      event.preventDefault();
      const previous = currentPath.current;
      begin("forward", async () => {
        router.push(url.pathname + url.search + url.hash);
        await waitForRoute(url.pathname, previous);
      });
    };
    const onPopState = () => {
      const target = window.location.pathname, previous = currentPath.current;
      if (!isMessagesRoute(target) || !isMessagesRoute(previous) || target === previous) return;
      begin(target === "/messages" ? "back" : "forward", () => waitForRoute(target, previous));
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
    };
  }, [router]);

  return <div className="messages-route-frame" data-messages-route={pathname}>{children}</div>;
}
