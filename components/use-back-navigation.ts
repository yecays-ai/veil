"use client";
import { useCallback, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { arrivedFromApp, subscribeNavigationOrigin } from "../lib/navigation-origin";

/** Back follows the actual in-app source; otherwise the page's own `backHref` fallback applies. */
export function useBackNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  // Server and hydration render the fallback link; the client then upgrades to history Back.
  const fromApp = useSyncExternalStore(subscribeNavigationOrigin, () => arrivedFromApp(pathname), () => false);
  const back = useCallback(() => router.back(), [router]);
  return fromApp ? { onBack: back } : {};
}
