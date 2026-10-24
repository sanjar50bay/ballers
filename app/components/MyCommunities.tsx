"use client";
import { t as tx } from "@/lib/i18n";

import { useLocale } from "@/app/components/Language";

import Link from "next/link";
import { useApp } from "./AppState";
export default function MyCommunities({
  creation = false,
}: {
  creation?: boolean;
}) {
  useLocale();

  const { data, loading, error, session, refresh } = useApp();
  if (loading)
    return <p className="ballers-muted">{tx("Загружаем сообщества…")}</p>;
  if (!session)
    return (
      <Link className="text-link" href="/">
        {tx("Войди, чтобы увидеть сообщества →")}
      </Link>
    );
  return (
    <>
      {error && (
        <div className="error-panel">
          {tx("Не удалось обновить сообщества.")}{" "}
          <button onClick={() => void refresh()}>{tx("Повторить")}</button>
        </div>
      )}
      <div className="space-y-3">
        {(creation
          ? data?.communities.filter((c) =>
              ["OWNER", "MANAGER"].includes(c.role),
            )
          : data?.communities
        )?.map((c) => (
          <section key={c.id} className="neon-panel border-[#2c8768]">
            <div className="community-row py-0">
              <span className="community-initial">
                {c.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((w) => w[0])
                  .join("")}
              </span>
              <div>
                <h2 className="font-bold text-lg">{c.name}</h2>
                <p className="ballers-muted">
                  {c.city || tx("Сообщество")} ·{" "}
                  {{
                    OWNER: tx("организатор"),
                    MANAGER: tx("менеджер"),
                    MEMBER: tx("участник"),
                  }[c.role] || tx("участник")}
                </p>
              </div>
            </div>
            <Link
              className="text-link mt-2"
              href={
                creation
                  ? `/communities/${c.id}/game-days/create`
                  : `/communities/${c.id}`
              }
            >
              {creation
                ? tx("Создать игровой день →")
                : tx("Открыть сообщество →")}
            </Link>
          </section>
        ))}
      </div>
      {!data?.communities.length && !error && (
        <p className="ballers-muted">
          {tx(
            "Пока нет сообществ. Создай своё или присоединись по приглашению.",
          )}
        </p>
      )}
    </>
  );
}
