"use client";
import { Suspense, useSyncExternalStore } from "react";
import {
  useParams,
  useSearchParams,
  useRouter,
  usePathname,
} from "next/navigation";
import Link from "next/link";
import { useApp } from "@/app/components/AppState";
import { useLocale } from "@/app/components/Language";
import {
  NetworkShell,
  NetworkError,
  PersonRow,
  useNetworkResource,
} from "@/app/components/Network";
import CommunityMenu from "@/app/components/CommunityMenu";
import { t, dateLocale, roleLabel } from "@/lib/i18n";
import { cityLabel, networkCount } from "@/lib/network";
import type { CommunityWorkspace } from "@/lib/community-workspace";
const subscribeHydration = () => () => {};
export default function CommunityPage() {
  const id = String(useParams().id);
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  if (!hydrated) return <p>…</p>;
  return (
    <Suspense fallback={<p>…</p>}>
      <Workspace key={id} id={id} />
    </Suspense>
  );
}
function Workspace({ id }: { id: string }) {
  useLocale();
  const { data: home } = useApp(),
    search = useSearchParams(),
    router = useRouter(),
    path = usePathname();
  const resource = useNetworkResource<CommunityWorkspace>(
    "ballers_community_workspace",
    { p_community: id },
    !!home?.profile,
  );
  const d = resource.data;
  const selected = search.get("tab");
  const tab =
    selected === "people"
      ? "people"
      : selected === "settings" && d?.can_manage
        ? "settings"
        : "games";
  const history = search.get("view") === "history";
  return (
    <NetworkShell>
      <NetworkError
        error={resource.error}
        retry={() => void resource.reload()}
      />
      {resource.loading && !d && (
        <p role="status">{t("Загружаем сообщество…")}</p>
      )}
      {d && (
        <>
          <header className="community-hero">
            <p className="eyebrow">
              {cityLabel(d.city || "")} · {t("Сообщество")}
            </p>
            <h1 className="page-title">{d.name}</h1>
            {d.member && (
              <p className="ballers-muted">
                {networkCount(d.member_count)}
                {d.can_manage ? " · " + t("Ты организатор") : ""}
              </p>
            )}
            {d.can_manage && (
              <Link
                className="neon-button green mt-4"
                href={`/communities/${id}/game-days/create`}
              >
                {t("Создать игру")}
              </Link>
            )}
          </header>
          {!d.member ? (
            <section className="network-card">
              <p>
                {t(
                  "Участники сообщества видят его игры и людей. Вступить можно по приглашению организатора.",
                )}
              </p>
              <Link
                className="text-link mt-4"
                href={`/discover/community/${id}`}
              >
                {t("Команды и организатор →")}
              </Link>
            </section>
          ) : (
            <>
              <nav
                className="directory-tabs team-section-tabs community-section-tabs"
                aria-label={t("Разделы сообщества")}
              >
                {[
                  ["games", "Игры"],
                  ["people", "Люди"],
                  ...(d.can_manage ? [["settings", "Управление"]] : []),
                ].map(([key, label]) => (
                  <button
                    key={key}
                    aria-pressed={tab === key}
                    className={tab === key ? "selected" : ""}
                    onClick={() =>
                      router.push(path + "?tab=" + key, { scroll: false })
                    }
                  >
                    {t(label)}
                  </button>
                ))}
              </nav>
              {tab === "games" && (
                <>
                  <nav
                    className="directory-tabs community-calendar-tabs"
                    aria-label={t("Период игр сообщества")}
                  >
                    <Link
                      aria-current={!history ? "page" : undefined}
                      className={!history ? "selected" : ""}
                      href={path + "?tab=games"}
                    >
                      {t("Ближайшие")}
                    </Link>
                    <Link
                      aria-current={history ? "page" : undefined}
                      className={history ? "selected" : ""}
                      href={path + "?tab=games&view=history"}
                    >
                      {t("История")}
                    </Link>
                  </nav>
                  <h2 className="section-title">
                    {t(
                      history
                        ? "История игр сообщества"
                        : "Ближайшие игры сообщества",
                    )}
                  </h2>
                  {d.games
                    .filter((g) => g.upcoming !== history)
                    .map((g) => (
                      <article className="network-card" key={g.id}>
                        <p className="eyebrow">
                          {new Date(
                            g.game_date + "T12:00:00",
                          ).toLocaleDateString(dateLocale(), {
                            day: "numeric",
                            month: "long",
                          })}{" "}
                          · {g.start_time?.slice(0, 5) || t("Время уточняется")}
                          {g.live ? " · " + t("Матч идёт") : ""}
                        </p>
                        <h3 className="font-bold mt-2">{g.title}</h3>
                        <p>{g.venue || t("Место уточняется")}</p>
                        <p className="ballers-muted text-sm my-3">
                          {g.format}×{g.format} ·{" "}
                          {t("Подтвердились: {count}", { count: g.going })}
                          {g.capacity ? " / " + g.capacity : ""}
                        </p>
                        <Link
                          className="neon-button green"
                          href={`/games/${g.id}/play?tab=overview`}
                        >
                          {t(
                            g.upcoming && g.attendance_status !== "GOING"
                              ? "Открыть и ответить"
                              : "К игре →",
                          )}
                        </Link>
                        {d.can_manage && (
                          <Link
                            className="text-link block mt-3"
                            href={`/communities/${id}/game-days/create?from=${g.id}`}
                          >
                            {t("На следующую неделю")}
                          </Link>
                        )}
                      </article>
                    ))}
                  {!d.games.some((g) => g.upcoming !== history) && (
                    <p className="network-card ballers-muted">
                      {t(
                        history
                          ? "В истории пока нет игр."
                          : "Ближайшая игра ещё не назначена.",
                      )}
                    </p>
                  )}
                  <p className="ballers-muted text-sm mt-4">
                    {t(
                      "Показываем до 20 игр в каждом разделе, к которым у тебя есть доступ.",
                    )}
                  </p>
                </>
              )}
              {tab === "people" && (
                <>
                  <h2 className="section-title">{t("Участники сообщества")}</h2>
                  {d.can_manage && (
                    <div className="mb-5">
                      <CommunityMenu
                        community={d}
                        canManage
                        inviteOnly
                        compact
                      />
                    </div>
                  )}
                  <Link
                    className="text-link mb-5"
                    href={`/discover/community/${id}`}
                  >
                    {t("Команды сообщества →")}
                  </Link>
                  {d.members.map((p) => (
                    <div key={p.id} className="mb-3">
                      <PersonRow person={p} />
                      <p className="ballers-muted text-sm">
                        {roleLabel(p.role)}
                        {p.member_status === "GUEST" ? " · " + t("Гость") : ""}
                      </p>
                    </div>
                  ))}
                  {d.member_count > d.members.length && (
                    <p className="ballers-muted">
                      {t("Показаны первые 100 участников.")}
                    </p>
                  )}
                </>
              )}
              {tab === "settings" && d.can_manage && (
                <section className="network-card">
                  <h2 className="section-title">{t("Настройки сообщества")}</h2>
                  <p className="ballers-muted mb-4">
                    {t(
                      "Применяются к новым игровым дням. Текущие матчи не меняются.",
                    )}
                  </p>
                  <p className="mb-4">
                    {d.default_format}×{d.default_format} ·{" "}
                    {t("Команд: {count}", { count: d.default_team_count })} ·{" "}
                    {t("Мест: {count}", { count: d.default_capacity ?? "∞" })}
                  </p>
                  <CommunityMenu
                    key={[
                      d.id,
                      d.name,
                      d.city,
                      d.default_format,
                      d.default_team_count,
                      d.default_capacity,
                      d.team_mode,
                    ].join(":")}
                    community={d}
                    canManage
                    onSaved={() => void resource.reload()}
                    settingsOnly
                  />
                </section>
              )}
            </>
          )}
        </>
      )}
    </NetworkShell>
  );
}
