import { ContactProfile } from "../../../components/contacts-pages";
export default async function Page({ params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = await params;
  return <ContactProfile characterId={characterId} />;
}
