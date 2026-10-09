export type ChatScrollIntent = {
  characterId: string;
  sessionId: string | undefined;
  value: boolean;
};

export function chatScrollIntentMatchesSession(
  intent: ChatScrollIntent,
  session: { characterId: string; id: string },
) {
  return intent.sessionId === session.id ||
    (intent.sessionId === undefined && intent.characterId === session.characterId);
}

export function shouldPositionChatHistoryAtBottom(
  intent: ChatScrollIntent,
  session: { characterId: string; id: string },
) {
  return chatScrollIntentMatchesSession(intent, session) ? intent.value : true;
}
