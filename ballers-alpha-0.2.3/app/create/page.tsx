import Link from "next/link";
import MyCommunities from "@/app/components/MyCommunities";
import BottomNav from "@/app/components/BottomNav";
import AppHeader from "@/app/components/AppHeader";
export default function Page() {
  return (
    <main className="ballers-shell">
      <AppHeader />
      <h1 className="page-title mb-6">Создать</h1>
      <Link href="/communities/create" className="neon-button green w-full">
        Новое сообщество →
      </Link>
      <h2 className="text-xl font-bold mt-8 mb-2">Игровой день</h2>
      <p className="ballers-muted mb-5">
        Выбери сообщество, в котором управляешь играми.
      </p>
      <MyCommunities creation />
      <BottomNav />
    </main>
  );
}
