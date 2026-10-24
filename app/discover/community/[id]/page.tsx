"use client";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useApp } from "@/app/components/AppState";
import { useLocale } from "@/app/components/Language";
import {
  NetworkShell,
  NetworkError,
  useNetworkResource,
} from "@/app/components/Network";
import { t } from "@/lib/i18n";
import { cityLabel, type TeamItem } from "@/lib/network";
type Preview = {
  id: string;
  name: string;
  city: string;
  member: boolean;
  organizer: { id: string; name: string } | null;
  teams: TeamItem[];
};
export default function Page() {
  useLocale();
  const id = String(useParams().id);
  const { data: home } = useApp();
  const { data, loading, error, reload } = useNetworkResource<Preview>(
    "ballers_community_preview",
    { p_community: id },
    !!home?.profile,
  );
  return (
    <NetworkShell>
      <Link className="text-link" href="/discover?kind=communities">
        {t("← Сообщества")}
      </Link>
      <NetworkError error={error} retry={() => void reload()} />
      {loading && !data && <p className="inline-loading">{t("Загружаем…")}</p>}
      {data && (
        <>
          <p className="eyebrow mt-5">{cityLabel(data.city)}</p>
          <h1 className="page-title">{data.name}</h1>
          {data.organizer && (
            <Link className="text-link" href={`/players/${data.organizer.id}`}>
              {t("Организатор")} · {data.organizer.name}
            </Link>
          )}
          {data.member ? (
            <Link className="neon-button mt-5" href={`/communities/${id}`}>
              {t("Открыть сообщество →")}
            </Link>
          ) : (
            <p className="ballers-muted my-5">
              {t(
                "Вступить в сообщество можно по приглашению организатора. Ответственный за команду может подать заявку из профиля команды.",
              )}
            </p>
          )}
          <div className="section-heading">
            <h2>{t("Команды сообщества")}</h2>
            <span className="ballers-muted">{data.teams.length}</span>
          </div>
          {data.teams.map((tm) => (
            <Link
              key={tm.id}
              className="network-card compact"
              href={`/teams/${tm.id}`}
            >
              <span className="team-mark">
                {tm.name.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <b>{tm.name}</b>
                <p className="ballers-muted">{cityLabel(tm.city)}</p>
              </div>
            </Link>
          ))}
          {!data.teams.length && (
            <p className="ballers-muted">
              {t(
                "Пока нет связанных команд. Участники сообщества и временные составы игровых дней сохранены.",
              )}
            </p>
          )}
          <Link href="/open-games" className="text-link mt-6">
            {t("Найти открытую игру →")}
          </Link>
        </>
      )}
    </NetworkShell>
  );
}
