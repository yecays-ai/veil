"use client";
import { useParams } from "next/navigation";
import { RegexRuleEditor } from "../../../../../../components/settings/regex/regex-rule-editor";
export default function Page() {
  const { groupId, ruleId } = useParams<{ groupId: string; ruleId: string }>();
  return <RegexRuleEditor groupId={groupId} ruleId={ruleId} />;
}
