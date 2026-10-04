import type { ChatMessage } from "./types";

export type UserMessageDeliveryState = "sent" | "delivered" | "read";
export type UserMessageReadStateResolver = {
  resolve(message: ChatMessage): UserMessageDeliveryState;
};

// Read state is intentionally resolved at this boundary rather than inferred
// from an AI reply. Character Activity / World State can own this transition later.
export const immediateReadState: UserMessageReadStateResolver = {
  resolve: () => "read",
};

export function resolveUserMessageDelivery(
  message: ChatMessage,
  resolver: UserMessageReadStateResolver = immediateReadState,
): UserMessageDeliveryState | null {
  if (message.role !== "user" || message.status !== "sent") return null;
  return resolver.resolve(message);
}

export function userMessageDeliveryLabel(state: UserMessageDeliveryState) {
  return state === "read" ? "Read" : "Delivered";
}
