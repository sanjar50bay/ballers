import { redirect } from "next/navigation";
export default async function Games({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/communities/${id}?tab=games`);
}
