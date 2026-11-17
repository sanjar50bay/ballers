"use client";
import { t as tx } from "@/lib/i18n";

import { useLocale } from "@/app/components/Language";
import Link from "next/link";
import MyCommunities from "@/app/components/MyCommunities";
export default function Page() {
  useLocale();

  return (
    <main className="ballers-shell">
      <h1 className="page-title mb-6">{tx("Создать игру")}</h1>
      <p className="ballers-muted mb-5">
        {tx("Выбери сообщество, в котором управляешь играми.")}
      </p>
      <MyCommunities creation />
      <Link href="/communities/create" className="text-link mt-6">
        {tx("Новое сообщество →")}
      </Link>
    </main>
  );
}
