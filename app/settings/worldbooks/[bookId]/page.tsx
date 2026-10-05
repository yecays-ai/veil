import { WorldBookDetail } from "../../../../components/settings/worldbooks/worldbook-detail";
export default async function Page({ params }: { params: Promise<{ bookId: string }> }) {
  return <WorldBookDetail bookId={(await params).bookId} />;
}
