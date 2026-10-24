"use client";
import { t as tx } from "@/lib/i18n";

import { useLocale } from "@/app/components/Language";

import Link from "next/link";
import Icon from "./Icon";
import { BellButton } from "./Notifications";
export default function AppHeader() {
  useLocale();

  return (
    <header className="ballers-header">
      <Link href="/" className="ballers-wordmark">
        BALLERS<span>.</span>
      </Link>
      <div className="flex gap-2">
        <Link className="icon-button" href="/create" aria-label={tx("Создать")}>
          <Icon name="plus" />
        </Link>
        <BellButton />
      </div>
    </header>
  );
}
