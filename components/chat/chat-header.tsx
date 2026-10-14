import Link from "next/link";
import type { RefObject } from "react";
import { ChevronLeft, Ellipsis } from "lucide-react";
import type { Presence, ProfileBasics } from "../../lib/foundation-types";
import { PresenceBadge, presenceLabel } from "../presence";
import { ChatAvatar } from "./avatar";

// Presentational only: ChatRoom owns the settings button ref, the focus-origin record and
// every layout effect. Loading and loaded rooms render this same component with the same
// key so the header is updated in place rather than remounted.
export function ChatHeader({ contact, presence, generating = false, settingsTrigger, onOpenSettings }: {
  // Null until the contact frame is published; the title then reads "Chat".
  contact: { characterId: string; name: string; profile: Pick<ProfileBasics, "name" | "avatar"> } | null;
  presence?: Presence;
  // A display-only override: never changes the stored routine or Last Seen.
  generating?: boolean;
  settingsTrigger: RefObject<HTMLButtonElement | null>;
  // Undefined while the room is loading: the settings button is rendered disabled.
  onOpenSettings?: () => void;
}) {
  const displayedPresence = generating ? "online" : presence;
  return (
    <header className="chat-header page-header">
      <Link href="/messages" className="chat-back page-back-btn" aria-label="Back to Messages">
        <ChevronLeft aria-hidden="true" />
      </Link>
      {contact ? <Link href={`/contacts/${encodeURIComponent(contact.characterId)}?from=direct`}
        className="chat-contact-summary page-title"
        aria-label={`Open Contact Info for ${contact.name}${displayedPresence ? `, ${presenceLabel(displayedPresence)}` : ""}`}>
        <span className="chat-avatar-presence"><ChatAvatar profile={contact.profile} />
          {displayedPresence && <PresenceBadge presence={displayedPresence} />}</span>
        <strong>{contact.name}</strong>
      </Link> : <strong className="chat-contact-summary page-title">Chat</strong>}
      {onOpenSettings ? <button ref={settingsTrigger} type="button" className="chat-settings-button page-back-btn"
        aria-label="Conversation settings" title="Conversation settings" onClick={onOpenSettings}>
        <Ellipsis aria-hidden="true" />
      </button> : <button type="button" className="chat-settings-button page-back-btn"
        aria-label="Conversation settings" disabled><Ellipsis aria-hidden="true" /></button>}
    </header>
  );
}
