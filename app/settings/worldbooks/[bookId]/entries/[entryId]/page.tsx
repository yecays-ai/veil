import { WorldBookEntryEditor } from "../../../../../../components/settings/worldbooks/worldbook-entry-editor";
export default async function Page({ params }: { params: Promise<{ bookId: string; entryId: string }> }) {
  const { bookId, entryId } = await params;
  return <WorldBookEntryEditor bookId={bookId} entryId={entryId} />;
}
