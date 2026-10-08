import { ContactProfile } from "../../../components/contacts-pages";

// No server-side request data is read here: the page is a cacheable shell and the return source
// (`?from=`) is resolved on the client. Contacts are device-local, so no ids are pre-rendered.
export function generateStaticParams() {
  return [];
}

export default async function Page({ params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = await params;
  return <ContactProfile characterId={characterId} />;
}
