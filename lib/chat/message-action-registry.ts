import type { ChatMessage } from "./types";

export type MessageActionPatch = Pick<ChatMessage, "content">;
export type MessageActionHelpers = {
  updateMessage(patch: MessageActionPatch): Promise<ChatMessage>;
  toast(text: string): void;
};
export type MessageAction = {
  id: string;
  label: string;
  filter?: (message: Readonly<ChatMessage>) => boolean;
  onSelect(message: Readonly<ChatMessage>, helpers: MessageActionHelpers): void | Promise<void>;
};

const actions = new Map<string, MessageAction>();
const listeners = new Set<() => void>();
let revision = 0;
function changed() {
  revision++;
  for (const listener of listeners) listener();
}
export function subscribeMessageActions(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function messageActionsRevision() { return revision; }

export function registerMessageAction(action: MessageAction) {
  if (!action.id.trim() || !action.label.trim() || typeof action.onSelect !== "function")
    throw new Error("Invalid message action.");
  if (actions.has(action.id)) throw new Error("Message action ID is already registered.");
  const registered = Object.freeze({ ...action });
  actions.set(action.id, registered);
  changed();
  const dispose = () => {
    if (actions.get(registered.id) !== registered) return;
    actions.delete(registered.id);
    changed();
  };
  return { dispose, unregister: dispose };
}

export function getMessageActions(message: ChatMessage): readonly MessageAction[] {
  const snapshot = Object.freeze({ ...message });
  return [...actions.values()].filter((action) => {
    try { return !action.filter || action.filter(snapshot); }
    catch { return false; }
  });
}

export async function runMessageAction(id: string, message: ChatMessage, helpers: MessageActionHelpers) {
  const action = getMessageActions(message).find((candidate) => candidate.id === id);
  if (!action) throw new Error("Message action is unavailable for this message.");
  await action.onSelect(Object.freeze({ ...message }), helpers);
}
