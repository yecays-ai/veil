import { GroupRoom } from "../../../../components/chat/group-room";
export default async function Page({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <GroupRoom sessionId={sessionId} />;
}
