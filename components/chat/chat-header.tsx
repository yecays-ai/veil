import Link from "next/link";
import type { RefObject } from "react";
import { ChevronLeft, ChevronRight, Ellipsis } from "lucide-react";
import type { ProfileBasics } from "../../lib/foundation-types";
import { ChatAvatar } from "./avatar";

// Presentational only: ChatRoom owns the settings button ref, the focus-origin record and
// every layout effect. Loading and loaded rooms render this same component with the same
// key so the header is updated in place rather than remounted.
export function ChatHeader({ contact, status, settingsTrigger, onOpenSettings }: {
  // Null until the contact frame is published; the title then reads "Chat".
  contact: { characterId: string; name: string; profile: Pick<ProfileBasics, "name" | "avatar"> } | null;
  // The line under the name. It is rendered (empty while Presence loads) whenever the contact is, so the name never moves.
  status?: string;
  settingsTrigger: RefObject<HTMLButtonElement | null>;
  // Undefined while the room is loading: the settings button is rendered disabled.
  onOpenSettings?: () => void;
}) {
  return (
    <header className="chat-header page-header">
      <Link href="/messages" className="chat-back page-back-btn" aria-label="Back to Messages">
        <ChevronLeft aria-hidden="true" />
      </Link>
      {contact ? <Link href={`/contacts/${encodeURIComponent(contact.characterId)}?from=direct`}
        className="chat-contact-summary page-title" aria-label={`Open Contact Info for ${contact.name}`}>
        <ChatAvatar profile={contact.profile} />
        <span className="chat-contact-text"><strong>{contact.name}</strong>
          <small className="chat-contact-status">{status}</small></span>
        <ChevronRight aria-hidden="true" />
      </Link> : <strong className="chat-contact-summary page-title">Chat</strong>}
      {onOpenSettings ? <button ref={settingsTrigger} type="button" className="chat-settings-button page-back-btn"
        aria-label="Conversation settings" title="Conversation settings" onClick={onOpenSettings}>
        <Ellipsis aria-hidden="true" />
      </button> : <button type="button" className="chat-settings-button page-back-btn"
        aria-label="Conversation settings" disabled><Ellipsis aria-hidden="true" /></button>}
    </header>
  );
}
