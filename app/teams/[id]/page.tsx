"use client";
import { useTeamAction } from "@/lib/use-network";
import {
  useParams,
  useRouter,
  usePathname,
  useSearchParams,
} from "next/navigation";
import { Suspense, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useApp } from "@/app/components/AppState";
import { useLocale } from "@/app/components/Language";
import {
  NetworkShell,
  NetworkError,
  PersonRow,
  useNetworkResource,
} from "@/app/components/Network";
import TacticalBoard from "@/app/components/TacticalBoard";
import TeamGames from "@/app/components/TeamGames";
import type { TeamCalendar } from "@/lib/team-calendar";
import { t } from "@/lib/i18n";
import {
  networkCount,
  changed,
  cityLabel,
  personName,
  networkError,
  type Person,
  type TeamItem,
} from "@/lib/network";
type Detail = {
  team: TeamItem;
  captain: boolean;
  my_status: string | null;
  members: (Person & { role: string })[];
  pending: (Person & { status: string })[];
  communities: { id: string; name: string; city: string; status: string }[];
};
type Results<T> = { items: T[]; has_more: boolean };
const subscribeHydration = () => () => {};
export default function Page() {
  const params = useParams();
  // Resolve the saved language before mounting the query-dependent private workspace.
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  if (!hydrated) return <p>…</p>;
  return (
    <Suspense fallback={<p>…</p>}>
      <TeamWorkspace key={String(params.id)} id={String(params.id)} />
    </Suspense>
  );
}
function TeamWorkspace({ id }: { id: string }) {
  useLocale();
  const runTeamAction = useTeamAction();
  const router = useRouter(),
    path = usePathname(),
    search = useSearchParams();
  const selectedTab = search.get("tab");
  const chooseTab = (next: string) => {
    router.push(path + "?tab=" + next, { scroll: false });
    setNotice("");
  };
  const { data: home } = useApp();
  const detail = useNetworkResource<Detail>(
    "ballers_team_detail",
    { p_team: id },
    !!home?.profile,
  );
  const tab =
    selectedTab === "games"
      ? "games"
      : detail.data?.captain && selectedTab === "invite"
        ? "invite"
        : detail.data?.captain &&
            ["settings", "communities"].includes(selectedTab || "")
          ? "settings"
          : "roster";
  const [query, setQuery] = useState(""),
    [communityQuery, setCommunityQuery] = useState(""),
    [selected, setSelected] = useState<Person[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [share, setShare] = useState("");
  const lock = useRef(false);
  const players = useNetworkResource<Results<Person>>(
    "ballers_directory",
    { p_kind: "players", p_city: "", p_query: query, p_offset: 0 },
    !!detail.data?.captain && tab === "invite" && query.trim().length >= 2,
  );
  const communities = useNetworkResource<Results<TeamItem>>(
    "ballers_directory",
    { p_kind: "communities", p_city: "", p_query: communityQuery, p_offset: 0 },
    !!detail.data?.captain &&
      tab === "settings" &&
      communityQuery.trim().length >= 2,
  );
  const calendar = useNetworkResource<TeamCalendar>(
    "ballers_team_calendar",
    { p_team: id },
    !!home?.profile && !!detail.data,
  );
  async function act(
    action: string,
    p_players: string[] = [],
    p_community: string | null = null,
    p_accept = true,
  ) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await runTeamAction({
        p_team: id,
        p_action: action,
        p_players,
        p_community,
        p_accept,
      });
      changed();
      await Promise.all([detail.reload(), calendar.reload()]);
      setNotice(t("Изменения сохранены."));
      return true;
    } catch (e) {
      setError(networkError(e));
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const d = detail.data;
  const occupied = new Set([
    ...(d?.members.map((p) => p.id) || []),
    ...(d?.pending.map((p) => p.id) || []),
  ]);
  return (
    <NetworkShell>
      <NetworkError error={detail.error} retry={() => void detail.reload()} />
      {detail.loading && !d && (
        <p role="status" className="inline-loading">
          {t("Загружаем…")}
        </p>
      )}
      {d && (
        <>
          <header className="team-hero">
            <div className="team-identity">
              <span className="team-mark">
                {d.team.name.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <p className="eyebrow">
                  {cityLabel(d.team.city)} · {t("Постоянная команда")}
                </p>
                <h1 className="page-title">{d.team.name}</h1>
                <p className="ballers-muted">
                  {networkCount(d.members.length)}
                  {d.captain ? " · " + t("Ты ответственный") : ""}
                </p>
              </div>
            </div>
            <div className="network-actions">
              {!d.my_status || d.my_status === "DECLINED" ? (
                <button
                  disabled={busy}
                  className="neon-button green"
                  onClick={() => void act("REQUEST")}
                >
                  {t("Хочу в команду")}
                </button>
              ) : d.my_status === "INVITED" ? (
                <>
                  <button
                    className="neon-button green"
                    disabled={busy}
                    onClick={() => void act("ANSWER_INVITE")}
                  >
                    {t("Принять приглашение")}
                  </button>
                  <button
                    className="network-secondary"
                    disabled={busy}
                    onClick={() => void act("ANSWER_INVITE", [], null, false)}
                  >
                    {t("Отклонить")}
                  </button>
                </>
              ) : !d.captain ? (
                <span className="network-badge">
                  {t(
                    d.my_status === "REQUESTED"
                      ? "Заявка отправлена"
                      : "Ты в команде",
                  )}
                </span>
              ) : null}
            </div>
            {d.captain && (
              <div className="network-actions team-primary-actions mt-3">
                <button
                  className="neon-button green"
                  onClick={() => chooseTab("invite")}
                >
                  {t("Пригласить игроков")}
                </button>
                <Link
                  className="network-secondary"
                  href={`/teams/${id}/games/create`}
                >
                  {t("Запланировать игру")}
                </Link>
              </div>
            )}
            <details className="mt-3">
              <summary className="text-link cursor-pointer py-2">
                {t("О команде")}
              </summary>
              <p className="ballers-muted mt-2 mb-3">
                {d.team.about || t("Команда собирает свою историю в BALLERS.")}
              </p>
              <button
                className="network-secondary"
                onClick={() => {
                  const url = window.location.origin + `/teams/${id}`;
                  setShare(url);
                  void navigator.clipboard?.writeText(url).catch(() => {});
                }}
              >
                {t("Ссылка команды")}
              </button>
              {share && (
                <label className="network-field mt-4">
                  <span>
                    {t(
                      "Скопируй и отправь игрокам. Вступление подтверждает ответственный.",
                    )}
                  </span>
                  <input
                    readOnly
                    value={share}
                    onFocus={(e) => e.target.select()}
                  />
                </label>
              )}
            </details>
          </header>
          <NetworkError error={error} />
          {notice && (
            <p role="status" className="network-success">
              {t(notice)}
            </p>
          )}
          <div
            className="directory-tabs team-section-tabs"
            role="group"
            aria-label={t("Разделы команды")}
          >
            {[
              ["roster", "Состав"],
              ["games", "Игры"],
              ...(d.captain ? [["settings", "Управление"]] : []),
            ].map(([key, label]) => (
              <button
                key={key}
                aria-pressed={
                  tab === key || (key === "roster" && tab === "invite")
                }
                className={
                  tab === key || (key === "roster" && tab === "invite")
                    ? "selected"
                    : ""
                }
                onClick={() => {
                  chooseTab(key);
                }}
              >
                {t(label)}
              </button>
            ))}
          </div>
          {tab === "games" && (
            <>
              <nav
                className="directory-tabs team-calendar-tabs mb-4"
                aria-label={t("Период игр команды")}
              >
                <Link
                  aria-current={
                    search.get("view") !== "history" ? "page" : undefined
                  }
                  className={search.get("view") !== "history" ? "selected" : ""}
                  href={path + "?tab=games"}
                >
                  {t("Ближайшие")}
                </Link>
                <Link
                  aria-current={
                    search.get("view") === "history" ? "page" : undefined
                  }
                  className={search.get("view") === "history" ? "selected" : ""}
                  href={path + "?tab=games&view=history"}
                >
                  {t("История")}
                </Link>
              </nav>
              <TeamGames
                data={calendar.data}
                loading={calendar.loading}
                error={calendar.error}
                retry={() => void calendar.reload()}
                teamId={id}
                captain={false}
                history={search.get("view") === "history"}
              />
            </>
          )}
          {tab === "roster" && (
            <>
              <TeamGames
                compact
                data={calendar.data}
                loading={calendar.loading}
                error={calendar.error}
                retry={() => void calendar.reload()}
                teamId={id}
                captain={false}
              />
              {d.captain && d.pending.length > 0 && (
                <h2 className="section-title">{t("Ожидают подтверждения")}</h2>
              )}
              {d.captain &&
                d.pending.map((p) => (
                  <article key={p.id} className="network-card">
                    <PersonRow person={p} />
                    <p className="ballers-muted">
                      {t(
                        p.status === "INVITED"
                          ? "Ожидаем ответа игрока"
                          : "Заявка игрока",
                      )}
                    </p>
                    {p.status === "REQUESTED" ? (
                      <div className="network-actions">
                        <button
                          className="neon-button green"
                          disabled={busy}
                          onClick={() => void act("ANSWER_REQUEST", [p.id])}
                        >
                          {t("Принять")}
                        </button>
                        <button
                          className="network-secondary"
                          disabled={busy}
                          onClick={() =>
                            void act("ANSWER_REQUEST", [p.id], null, false)
                          }
                        >
                          {t("Отклонить")}
                        </button>
                      </div>
                    ) : (
                      <button
                        disabled={busy}
                        className="text-link"
                        onClick={() => void act("REMOVE", [p.id])}
                      >
                        {t("Отменить приглашение")}
                      </button>
                    )}
                  </article>
                ))}
              <h2 className="section-title">{t("Подтверждённый состав")}</h2>
              {d.members.map((p) => (
                <article className="network-card" key={p.id}>
                  <PersonRow person={p} />
                  <span className="network-badge">
                    {t(p.role === "CAPTAIN" ? "Ответственный" : "Игрок")}
                  </span>
                  {d.captain && p.role !== "CAPTAIN" && (
                    <details className="mt-2">
                      <summary className="text-link cursor-pointer py-2">
                        {t("Действия с игроком")}
                      </summary>
                      <button
                        disabled={busy}
                        className="text-link"
                        onClick={() => {
                          if (
                            confirm(
                              t(
                                "Убрать игрока из команды? Его история сохранится.",
                              ),
                            )
                          )
                            void act("REMOVE", [p.id]);
                        }}
                      >
                        {t("Убрать из состава")}
                      </button>
                    </details>
                  )}
                </article>
              ))}
              {!d.captain && d.my_status && (
                <button
                  className="network-secondary mt-5"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        t(
                          "Отменить участие в команде? История матчей сохранится.",
                        ),
                      )
                    )
                      void act("LEAVE");
                  }}
                >
                  {t(
                    d.my_status === "REQUESTED"
                      ? "Отозвать заявку"
                      : "Покинуть команду",
                  )}
                </button>
              )}
            </>
          )}
          {tab === "invite" && d.captain && (
            <section>
              <Link href={path + "?tab=roster"} className="text-link">
                {t("← К составу")}
              </Link>
              <h2 className="section-title">{t("Найди своих игроков")}</h2>
              <p className="ballers-muted mb-4">
                {t(
                  "Поиск по всем городам. Выбери до 30 человек; каждый подтвердит приглашение сам.",
                )}
              </p>
              <label className="network-field">
                <span>{t("Имя, ник или Baller ID")}</span>
                <input
                  value={query}
                  maxLength={80}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <NetworkError
                error={players.error}
                retry={() => void players.reload()}
              />
              {players.loading && <p role="status">{t("Ищем…")}</p>}
              {query.trim().length < 2 && (
                <p className="ballers-muted">{t("Введи минимум 2 символа.")}</p>
              )}
              {query.trim().length >= 2 &&
                !players.loading &&
                players.data?.items.length === 0 && (
                  <p className="ballers-muted">{t("Пока никого не нашли")}</p>
                )}
              {players.data?.items
                .filter((p) => !occupied.has(p.id))
                .map((p) => (
                  <article key={p.id} className="network-card">
                    <PersonRow person={p}>
                      <button
                        className="network-secondary"
                        aria-pressed={selected.some((s) => s.id === p.id)}
                        disabled={
                          !selected.some((s) => s.id === p.id) &&
                          selected.length >= 30
                        }
                        onClick={() =>
                          setSelected((s) =>
                            s.some((x) => x.id === p.id)
                              ? s.filter((x) => x.id !== p.id)
                              : [...s, p],
                          )
                        }
                      >
                        {t(
                          selected.some((s) => s.id === p.id)
                            ? "Выбран"
                            : "Выбрать",
                        )}
                      </button>
                    </PersonRow>
                  </article>
                ))}
              {selected.length > 0 && (
                <div className="selection-tray">
                  <b>
                    {t("Выбрано")} · {selected.length}
                  </b>
                  <div className="selection-names">
                    {selected.map((p) => (
                      <button
                        className="network-secondary"
                        key={p.id}
                        onClick={() =>
                          setSelected((s) => s.filter((x) => x.id !== p.id))
                        }
                      >
                        {personName(p)} ×
                      </button>
                    ))}
                  </div>
                  <button
                    className="neon-button green w-full"
                    disabled={busy}
                    onClick={() =>
                      void (async () => {
                        if (
                          await act(
                            "INVITE",
                            selected.map((p) => p.id),
                          )
                        ) {
                          setSelected([]);
                          setQuery("");
                          chooseTab("roster");
                        }
                      })()
                    }
                  >
                    {t(busy ? "Отправляем…" : "Отправить приглашения")}
                  </button>
                </div>
              )}
              {players.data?.has_more && (
                <p className="ballers-muted">
                  {t(
                    "Уточни имя или Baller ID, чтобы найти остальных игроков.",
                  )}
                </p>
              )}
            </section>
          )}
          {tab === "settings" && d.captain && (
            <>
              <h2 className="section-title">{t("Команда в сообществах")}</h2>
              <p className="ballers-muted mb-4">
                {t(
                  "Одна команда может играть в нескольких сообществах. Состав и Baller ID не дублируются.",
                )}
              </p>
              {d.communities.map((c) => (
                <article className="network-card" key={c.id}>
                  <Link href={`/discover/community/${c.id}`}>
                    <h3>{c.name}</h3>
                    <p className="ballers-muted">
                      {cityLabel(c.city)} ·{" "}
                      {t(
                        c.status === "ACTIVE"
                          ? "Подтверждено"
                          : "Ждём организатора",
                      )}
                    </p>
                  </Link>
                  {d.captain && (
                    <button
                      className="text-link"
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(t("Убрать связь команды с этим сообществом?"))
                        )
                          void act("UNLINK", [], c.id);
                      }}
                    >
                      {t("Отменить участие")}
                    </button>
                  )}
                </article>
              ))}
              {!d.communities.length && (
                <p className="ballers-muted mb-5">
                  {t("Пока нет связанных сообществ.")}
                </p>
              )}
              {d.captain && (
                <>
                  <label className="network-field">
                    <span>{t("Найти сообщество")}</span>
                    <input
                      value={communityQuery}
                      maxLength={80}
                      onChange={(e) => setCommunityQuery(e.target.value)}
                    />
                  </label>
                  <NetworkError error={communities.error} />
                  {communityQuery.trim().length < 2 && (
                    <p className="ballers-muted">
                      {t("Введи минимум 2 символа.")}
                    </p>
                  )}
                  {communities.data?.items
                    .filter((c) => !d.communities.some((x) => x.id === c.id))
                    .map((c) => (
                      <article className="network-card" key={c.id}>
                        <b>{c.name}</b>
                        <p className="ballers-muted">{cityLabel(c.city)}</p>
                        <button
                          className="text-link"
                          disabled={busy}
                          onClick={() => void act("LINK", [], c.id)}
                        >
                          {t("Подать заявку от команды")}
                        </button>
                      </article>
                    ))}
                </>
              )}
            </>
          )}
          {tab === "roster" && (
            <details className="network-card">
              <summary className="cursor-pointer py-2 font-bold">
                {t("Расстановка команды")}
              </summary>
              <TacticalBoard
                teamId={id}
                members={d.members}
                editable={d.captain}
              />
            </details>
          )}
        </>
      )}
    </NetworkShell>
  );
}
