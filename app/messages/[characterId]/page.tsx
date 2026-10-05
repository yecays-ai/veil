import { ChatRoom } from "../../../components/chat/chat-room";
export default async function Page({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const { characterId } = await params;
  return <ChatRoom key={characterId} characterId={characterId} />;
}
