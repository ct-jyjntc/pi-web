import { CollabViewer } from "@/components/CollabViewer";

export default async function CollabPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <CollabViewer token={token} />;
}
