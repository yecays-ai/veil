import { Suspense } from "react";
import { ContactsHome, ContactsRoute } from "../../components/contacts-pages";

export default function Page() {
  return <Suspense fallback={<ContactsHome />}><ContactsRoute /></Suspense>;
}
