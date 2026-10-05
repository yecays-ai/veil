import type { ReactNode } from "react";

/** Stable presentation slot for future message extensions; empty by default. */
export function MessageFooter({ messageId, children }: { messageId: string; children?: ReactNode }) {
  return <div data-extension-slot="message.footer" data-message-id={messageId}>{children}</div>;
}
