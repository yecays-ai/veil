import { ContactsHome } from "../../components/contacts-pages";
export default async function Page({ searchParams }: {
  searchParams: Promise<{ mode?: string; contact?: string | string[] }>;
}) {
  const params = await searchParams;
  const mode = params.mode === "single" || params.mode === "multi" ? params.mode : undefined;
  const initialSelection = params.contact === undefined ? [] :
    Array.isArray(params.contact) ? params.contact : [params.contact];
  return <ContactsHome mode={mode} initialSelection={initialSelection} />;
}
