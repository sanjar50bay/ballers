"use client";
import { useTeamAction } from "@/lib/use-network";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
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
import Icon from "@/app/components/Icon";
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
export default function Page() {
  useLocale();
  const runTeamAction = useTeamAction();
  const params = useParams();
  const id = String(params.id);
  const { data: home } = useApp();
  const detail = useNetworkResource<Detail>(
    "ballers_team_detail",
    { p_team: id },
    !!home?.profile,
  );
  const [tab, setTab] = useState("overview"),
    [query, setQuery] = useState(""),
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
      tab === "communities" &&
      communityQuery.trim().length >= 2,
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
      await detail.reload();
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
      <Link href="/discover?kind=teams" className="text-link">
        {t("← Команды")}
      </Link>
      <NetworkError error={detail.error} retry={() => void detail.reload()} />
      {detail.loading && !d && (
        <p role="status" className="inline-loading">
          {t("Загружаем…")}
        </p>
      )}
      {d && (
        <>
          <header className="team-hero">
            <span className="team-mark large">
              {d.team.name.slice(0, 2).toUpperCase()}
            </span>
            <p className="eyebrow">
              {cityLabel(d.team.city)} · {t("Постоянная команда")}
            </p>
            <h1 className="page-title">{d.team.name}</h1>
            <p className="ballers-muted">
              {networkCount(d.members.length)}
              {d.captain ? " · " + t("Ты ответственный") : ""}
            </p>
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
              ) : (
                <span className="network-badge">
                  {t(
                    d.my_status === "REQUESTED"
                      ? "Заявка отправлена"
                      : "Ты в команде",
                  )}
                </span>
              )}
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
            </div>
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
          </header>
          <NetworkError error={error} />
          {notice && (
            <p role="status" className="network-success">
              {t(notice)}
            </p>
          )}
          <div
            className="directory-tabs"
            role="group"
            aria-label={t("Разделы команды")}
          >
            {[
              ["overview", "Обзор"],
              ["roster", "Состав"],
              ["communities", "Сообщества"],
              ...(d.captain ? [["invite", "Пригласить"]] : []),
            ].map(([key, label]) => (
              <button
                key={key}
                aria-pressed={tab === key}
                className={tab === key ? "selected" : ""}
                onClick={() => {
                  setTab(key);
                  setNotice("");
                }}
              >
                {t(label)}
              </button>
            ))}
          </div>
          {tab === "overview" && (
            <>
              <section className="network-card">
                <h2>{t("О команде")}</h2>
                <p className="ballers-muted mt-3">
                  {d.team.about ||
                    t("Команда собирает свою историю в BALLERS.")}
                </p>
              </section>
              <section className="network-card">
                <h2>{t("Статистика команды")}</h2>
                <p className="ballers-muted mt-3">
                  {t(
                    "Постоянные команды ещё не связаны с результатами игровых дней. Победы и поражения появятся после подключения командных матчей; старые результаты игроков сохранены.",
                  )}
                </p>
              </section>
              <Link href="/open-games" className="search-panel">
                <Icon name="ball" />
                <b>{t("Найти открытую игру →")}</b>
              </Link>
            </>
          )}
          {tab === "roster" && (
            <>
              <h2 className="section-title">{t("Подтверждённый состав")}</h2>
              {d.members.map((p) => (
                <article className="network-card" key={p.id}>
                  <PersonRow person={p} />
                  <span className="network-badge">
                    {t(p.role === "CAPTAIN" ? "Ответственный" : "Игрок")}
                  </span>
                  {d.captain && p.role !== "CAPTAIN" && (
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
                  )}
                </article>
              ))}
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
                          setTab("roster");
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
          {tab === "communities" && (
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
          <TacticalBoard teamId={id} members={d.members} editable={d.captain} />
        </>
      )}
    </NetworkShell>
  );
}
