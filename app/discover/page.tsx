"use client";
import { useTeamAction } from "@/lib/use-network";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useApp } from "../components/AppState";
import { useLocale } from "../components/Language";
import Icon from "../components/Icon";
import {
  CitySelect,
  NetworkShell,
  NetworkError,
  PersonRow,
  useNetworkResource,
} from "../components/Network";
import { t } from "@/lib/i18n";
import {
  networkCount,
  cityLabel,
  changed,
  networkError,
  searchLabel,
  type Person,
  type TeamItem,
  type NetworkData,
  type InboxItem,
} from "@/lib/network";
type Item = Person & TeamItem & { teams?: number };
type Directory = { items: Item[]; has_more: boolean; total: number };
export default function Page() {
  useLocale();
  return (
    <Suspense
      fallback={<p className="inline-loading">{t("Загружаем BALLERS…")}</p>}
    >
      <Discover />
    </Suspense>
  );
}
function Discover() {
  useLocale();
  const runTeamAction = useTeamAction();
  const params = useSearchParams();
  const { data: home } = useApp();
  const [kind, setKind] = useState(params.get("kind") || "players"),
    [city, setCity] = useState(""),
    [query, setQuery] = useState(""),
    [debounced, setDebounced] = useState(""),
    [offset, setOffset] = useState(0),
    [free, setFree] = useState(false),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState("");
  const lock = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(query);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  const { data, loading, error, reload } = useNetworkResource<Directory>(
    "ballers_directory",
    {
      p_kind: ["players", "teams", "communities"].includes(kind)
        ? kind
        : "players",
      p_city: city,
      p_query: debounced,
      p_offset: offset,
      p_free: free,
    },
    !!home?.profile && kind !== "inbox",
  );
  const net = useNetworkResource<NetworkData>(
    "ballers_network",
    {},
    !!home?.profile,
  );
  useEffect(() => {
    const next = params.get("kind") || "players";
    const tm = setTimeout(() => {
      setKind(next);
      setQuery("");
      setDebounced("");
      setOffset(0);
      setFree(false);
    }, 0);
    return () => clearTimeout(tm);
  }, [params]);
  const choose = (s: string) => {
    setKind(s);
    setOffset(0);
    setQuery("");
    setDebounced("");
    setFree(false);
    window.history.replaceState(null, "", `/discover?kind=${s}`);
  };
  async function answer(item: InboxItem, accept: boolean) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setActionError("");
    try {
      await runTeamAction({
        p_team: item.team_id,
        p_action: {
          INVITE: "ANSWER_INVITE",
          REQUEST: "ANSWER_REQUEST",
          LINK: "ANSWER_LINK",
        }[item.kind],
        p_players: item.kind === "REQUEST" ? [item.player_id] : [],
        p_community: item.community_id || null,
        p_accept: accept,
      });
      changed();
      await net.reload();
    } catch (e) {
      setActionError(networkError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <NetworkShell>
      <div className="directory-title">
        <div>
          <p className="eyebrow">{t("Футбол твоего города")}</p>
          <h1 className="page-title">{t("Найти")}</h1>
        </div>
        <Link className="neon-button" href="/teams/create">
          + {t("Команда")}
        </Link>
      </div>
      <p className="ballers-muted mb-5" data-coach="catalog-intro">
        {t(
          "Общий каталог: игроки, постоянные команды и сообщества всех организаторов.",
        )}
      </p>
      <div
        data-coach="directory"
        className="directory-tabs"
        role="group"
        aria-label={t("Категории поиска")}
      >
        {[
          ["players", "Игроки"],
          ["teams", "Команды"],
          ["communities", "Сообщества"],
          ["inbox", "Запросы"],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={kind === key}
            className={kind === key ? "selected" : ""}
            onClick={() => choose(key)}
          >
            {t(label)}
            {key === "inbox" && net.data?.inbox.length
              ? " · " + net.data.inbox.length
              : ""}
          </button>
        ))}
      </div>
      {kind === "communities" && (
        <Link className="text-link mb-4" href="/communities">
          {t("Мои сообщества →")}
        </Link>
      )}
      {kind !== "inbox" && (
        <>
          <CitySelect
            value={city}
            all
            onChange={(v) => {
              setCity(v);
              setOffset(0);
            }}
          />
          <label className="network-field">
            <span>
              {t(
                kind === "players"
                  ? "Имя, ник или Baller ID"
                  : kind === "teams"
                    ? "Название команды"
                    : "Название сообщества",
              )}
            </span>
            <div className="search-input">
              <Icon name="search" size={20} />
              <input
                maxLength={80}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t(
                  kind === "players"
                    ? "Имя, ник или Baller ID"
                    : kind === "teams"
                      ? "Название команды"
                      : "Название сообщества",
                )}
              />
            </div>
          </label>
          {city && city !== "Astana" && (
            <p className="city-note">
              {t(
                "Сейчас запускаемся в Астане. Другие города уже доступны для профилей и команд; игр пока может не быть.",
              )}
            </p>
          )}
          {kind === "players" && (
            <label className="network-check">
              <input
                type="checkbox"
                checked={free}
                onChange={(e) => {
                  setFree(e.target.checked);
                  setOffset(0);
                }}
              />
              {t("Только ищущие команду")}
            </label>
          )}
          <p className="ballers-muted my-3">
            {t("Находи игроков, команды и сообщества в своём городе.")}
          </p>
          {data && (
            <p role="status" className="ballers-muted my-3">
              {t("Найдено: {count}", {
                count: data.total ?? data.items.length,
              })}
            </p>
          )}
          <NetworkError error={error} retry={() => void reload()} />
          {loading && (
            <p role="status" className="ballers-muted my-4">
              {t("Ищем…")}
            </p>
          )}
          <div className="directory-results" aria-busy={loading}>
            {!loading && !error && data?.items.length === 0 && (
              <section className="neon-panel">
                <h2>{t("Пока никого не нашли")}</h2>
                <p className="ballers-muted mt-2">
                  {t(
                    "Попробуй другой город или запрос. Можно пригласить друзей по ссылке на BALLERS.",
                  )}
                </p>
              </section>
            )}
            {!loading &&
              !error &&
              data?.items.map((item) =>
                kind === "players" ? (
                  <article className="network-card" key={item.id}>
                    <PersonRow person={item} />
                    {item.search_status === "LOOKING" && (
                      <span className="network-badge">
                        {searchLabel(item.search_status)}
                      </span>
                    )}
                  </article>
                ) : (
                  <Link
                    className="network-card"
                    key={item.id}
                    href={
                      kind === "teams"
                        ? `/teams/${item.id}`
                        : `/discover/community/${item.id}`
                    }
                  >
                    <div className="directory-row">
                      <span
                        className={
                          "team-mark " + (kind === "communities" ? "green" : "")
                        }
                      >
                        {item.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <h2>{item.name}</h2>
                        <p className="ballers-muted">{cityLabel(item.city)}</p>
                      </div>
                      <Icon name="chevron" size={18} />
                    </div>
                    <p className="ballers-muted mt-3">
                      {networkCount(item.members || 0)}
                      {kind === "communities"
                        ? ` · ${networkCount(item.teams || 0, "teams")}`
                        : ""}
                    </p>
                  </Link>
                ),
              )}
          </div>
          {!error && data && (
            <div className="network-pagination">
              <button
                disabled={offset === 0 || loading}
                onClick={() => setOffset((n) => Math.max(0, n - 24))}
              >
                {t("Назад")}
              </button>
              <span className="ballers-muted">
                {t("Страница {page} из {pages}", {
                  page: Math.floor(offset / 24) + 1,
                  pages: Math.max(
                    1,
                    Math.ceil((data.total ?? data.items.length) / 24),
                  ),
                })}
              </span>
              <button
                disabled={!data.has_more || loading}
                onClick={() => setOffset((n) => n + 24)}
              >
                {t("Дальше")}
              </button>
            </div>
          )}
        </>
      )}
      {kind === "inbox" && (
        <>
          <NetworkError
            error={net.error || actionError}
            retry={() => void net.reload()}
          />
          {net.loading && <p role="status">{t("Загружаем…")}</p>}
          {!net.loading && net.data?.inbox.length === 0 && (
            <section className="neon-panel">
              <h2>{t("Всё разобрано")}</h2>
              <p className="ballers-muted mt-2">
                {t(
                  "Здесь появятся приглашения в команды и заявки на подтверждение.",
                )}
              </p>
            </section>
          )}
          {net.data?.inbox.map((item, i) => (
            <article
              key={`${item.kind}-${item.team_id}-${i}`}
              className="network-card"
            >
              <span className="eyebrow">
                {t(
                  {
                    INVITE: "Приглашение в команду",
                    REQUEST: "Заявка в команду",
                    LINK: "Команда хочет в сообщество",
                  }[item.kind],
                )}
              </span>
              <Link href={`/teams/${item.team_id}`}>
                <h2 className="mt-2">{item.name}</h2>
              </Link>
              <p className="ballers-muted mt-2">
                {item.kind === "REQUEST"
                  ? item.player_name
                  : item.community_name}
              </p>
              <div className="network-actions">
                <button
                  className="neon-button green"
                  disabled={busy}
                  onClick={() => void answer(item, true)}
                >
                  {t("Принять")}
                </button>
                <button
                  className="network-secondary"
                  disabled={busy}
                  onClick={() => void answer(item, false)}
                >
                  {t("Отклонить")}
                </button>
              </div>
            </article>
          ))}
        </>
      )}
      <Link className="text-link mt-6" href="/open-games">
        {t("Найти открытую игру →")}
      </Link>
    </NetworkShell>
  );
}
