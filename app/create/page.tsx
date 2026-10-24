"use client";
import { t as tx } from "@/lib/i18n";

import { useLocale } from "@/app/components/Language";
import Link from "next/link";
import MyCommunities from "@/app/components/MyCommunities";
import BottomNav from "@/app/components/BottomNav";
import AppHeader from "@/app/components/AppHeader";
export default function Page() {
  useLocale();

  return (
    <main className="ballers-shell">
      <AppHeader />
      <h1 className="page-title mb-6">{tx("Создать")}</h1>
      <Link href="/communities/create" className="neon-button green w-full">
        {tx("Новое сообщество →")}
      </Link>
      <h2 className="text-xl font-bold mt-8 mb-2">{tx("Игровой день")}</h2>
      <p className="ballers-muted mb-5">
        {tx("Выбери сообщество, в котором управляешь играми.")}
      </p>
      <MyCommunities creation />
      <BottomNav />
    </main>
  );
}
