import type { ReactNode } from "react";
import { MessagesRouteTransition } from "./route-transition";
import "./chat.css";
export default function MessagesLayout({ children }: { children: ReactNode }) {
  return <MessagesRouteTransition>{children}</MessagesRouteTransition>;
}
