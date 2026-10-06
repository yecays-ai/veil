import { ContactProfile } from "../../../components/contacts-pages";
import type { ContactReturnSource } from "../../../lib/contact-navigation";

export default async function Page({ params, searchParams }: {
  params: Promise<{ characterId: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { characterId } = await params;
  const { from } = await searchParams;
  const returnSource: ContactReturnSource = from === "direct" ? "direct" : undefined;
  return <ContactProfile characterId={characterId} returnSource={returnSource} />;
}
