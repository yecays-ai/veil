import "../../settings/settings.css";
import "../../characters/[characterId]/memory/memory.css";
import { Suspense } from "react";
import { MemoryCharacterPage } from "../../../components/memory-app";

// Characters are device-local; the shell is cacheable and data comes from the shared client store.
export function generateStaticParams() {
  return [];
}

export default async function Page({ params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = await params;
  return <Suspense fallback={null}><MemoryCharacterPage characterId={characterId} /></Suspense>;
}
