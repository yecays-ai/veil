"use client";
import { useParams } from "next/navigation";
import { RegexDetail } from "../../../../components/settings/regex/regex-detail";
export default function Page() {
  const { groupId } = useParams<{ groupId: string }>();
  return <RegexDetail groupId={groupId} />;
}
