import { redirect } from "next/navigation";
export default async function Page({params}: {params: Promise<{id:string;gameId:string}>}) {
 const {gameId}=await params;redirect(`/games/${encodeURIComponent(gameId)}/play?tab=participants`);
}
