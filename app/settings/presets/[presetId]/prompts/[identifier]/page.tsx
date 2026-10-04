import { PromptEditor } from "../../../../../../components/settings/presets/prompt-editor";
export default async function Page({ params }: { params: Promise<{ presetId: string; identifier: string }> }) {
  const { presetId, identifier } = await params;
  return <PromptEditor key={`${presetId}:${identifier}`} presetId={presetId} identifier={identifier} />;
}
