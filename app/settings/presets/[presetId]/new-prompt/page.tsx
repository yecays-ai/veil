import { PromptEditor } from "../../../../../components/settings/presets/prompt-editor";
export default async function Page({ params }: { params: Promise<{ presetId: string }> }) {
  const { presetId } = await params;
  return <PromptEditor key={presetId} presetId={presetId} />;
}
