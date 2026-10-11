import { createLiveDocument } from "../live-document";
import { PRESENCE_CHANGE_EVENT, PRESENCE_STORAGE_KEY, browserPresenceStorage, emptyPresenceDocument, type PresenceDocument } from "./storage";

/** One app-session read owner for Presence; durable writes stay with the storage module. */
export const livePresence = createLiveDocument<PresenceDocument>({
  initial: emptyPresenceDocument(), load: () => browserPresenceStorage.load(),
  key: PRESENCE_STORAGE_KEY, event: PRESENCE_CHANGE_EVENT,
  // Unreadable or newer-version data never counts as loaded: surfaces show nothing rather than a guessed Offline.
  error: "Presence could not be loaded.",
});
