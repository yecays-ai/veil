import { CharacterPage } from "../../../components/profile-pages";
export default async function Page({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const { characterId } = await params;
  return <CharacterPage characterId={characterId} />;
}
