"use client";

import { useParams } from "next/navigation";
import { ContactInfo } from "../../../components/contact-info";

export default function Loading() {
  const { characterId } = useParams<{ characterId: string }>();
  return <ContactInfo characterId={characterId} pending />;
}
