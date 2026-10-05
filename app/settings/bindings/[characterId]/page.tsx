import { BindingEditor } from "../../../../components/settings/bindings/binding-manager";
export default async function Page({ params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = await params;
  return <BindingEditor characterId={characterId} />;
}
