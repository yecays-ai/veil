import { CharacterSocialProfile } from "../../../components/character-social-profile";
import "../../contacts/contact-info.css";

export default async function Page({ params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = await params;
  return <CharacterSocialProfile characterId={characterId} />;
}
