import Link from "next/link";
import MyCommunities from "@/app/components/MyCommunities";
import BottomNav from "@/app/components/BottomNav";
import AppHeader from "@/app/components/AppHeader";
export default function Page() {
  return (
    <main className="ballers-shell">
      <AppHeader />
      <h1 className="page-title">Сообщества</h1>
      <p className="ballers-muted mb-6">Твои футбольные компании</p>
      <MyCommunities />
      <Link className="neon-button green mt-6" href="/communities/create">
        Создать сообщество →
      </Link>
      <br />
      <Link className="text-link mt-4" href="/open-games">
        Найти открытую игру →
      </Link>
      <BottomNav />
    </main>
  );
}
