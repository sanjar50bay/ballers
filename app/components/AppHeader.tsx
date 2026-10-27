"use client";

import { useLocale } from "@/app/components/Language";

import Link from "next/link";
import CreateMenu from "./CreateMenu";
import { BellButton } from "./Notifications";
export default function AppHeader() {
  useLocale();

  return (
    <header className="ballers-header">
      <Link href="/" className="ballers-wordmark">
        BALLERS<span>.</span>
      </Link>
      <div className="flex gap-2">
        <CreateMenu />
        <BellButton />
      </div>
    </header>
  );
}
