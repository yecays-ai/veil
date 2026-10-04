import { NewPromptEditor } from "../../../../../components/settings/presets/prompt-editor";
export default async function Page({ params }: { params: Promise<{ presetId: string }> }) {
  const { presetId } = await params;
  return <NewPromptEditor key={presetId} presetId={presetId} />;
}
