import { BindingEditor } from "../../../../../components/settings/bindings/binding-manager";
export default async function Page({ params }: { params: Promise<{ characterId: string; appId: string }> }) {
  const { characterId, appId } = await params;
  return <BindingEditor characterId={characterId} appId={appId} />;
}
