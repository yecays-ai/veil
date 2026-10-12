import "../../../settings/settings.css";
import "./memory.css";
import { MemoryBankPage } from "../../../../components/memory-bank";

// Characters are device-local; the shell is cacheable and data comes from the shared client store.
export function generateStaticParams() {
  return [];
}

export default async function Page({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const { characterId } = await params;
  return <MemoryBankPage characterId={characterId} />;
}
