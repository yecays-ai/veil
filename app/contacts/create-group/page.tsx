import { CreateGroupPage } from "../../../components/contacts-pages";

export default async function Page({ searchParams }: {
  searchParams: Promise<{ contact?: string | string[] }>;
}) {
  const value = (await searchParams).contact;
  const characterIds = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return <CreateGroupPage characterIds={[...new Set(characterIds)]} />;
}
