import { ChatRoom } from "../../../components/chat/chat-room";
export default async function Page({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  return <ChatRoom key={conversationId} conversationId={conversationId} />;
}
