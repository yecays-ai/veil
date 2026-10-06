import { Suspense } from "react";
import { CreateGroupPage, CreateGroupRoute } from "../../../components/contacts-pages";

export default function Page() {
  return <Suspense fallback={<CreateGroupPage characterIds={[]} />}><CreateGroupRoute /></Suspense>;
}
