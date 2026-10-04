import { PresetDetail } from "../../../../components/settings/presets/preset-detail";
export default async function Page({ params }: { params: Promise<{ presetId: string }> }) {
  const { presetId } = await params;
  return <PresetDetail key={presetId} presetId={presetId} />;
}
