"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "./AppState";
import AppHeader from "./AppHeader";
import BottomNav from "./BottomNav";
import Avatar from "./Avatar";
import Icon from "./Icon";
import { useLocale } from "./Language";
import { t, positionLabel } from "@/lib/i18n";
import {
  cities,
  cityKey,
  cityLabel,
  personName,
  rememberDestination,
  type Person,
  type NetworkData,
} from "@/lib/network";
export { useNetworkResource } from "@/lib/use-network";
import { useNetworkResource } from "@/lib/use-network";
export function NetworkShell({ children }: { children: React.ReactNode }) {
  useLocale();
  const { session, data, loading, error, refresh } = useApp();
  const path = usePathname();
  if (loading)
    return (
      <main className="ballers-shell">
        <p className="inline-loading">{t("Загружаем BALLERS…")}</p>
      </main>
    );
  if (!session)
    return (
      <main className="ballers-shell">
        <AppHeader />
        <h1 className="page-title">{t("Твой футбол начинается здесь")}</h1>
        <p className="ballers-muted">
          {t(
            "Войди, чтобы найти игроков, команды и сообщества. По ссылке команды можно подать заявку после входа.",
          )}
        </p>
        <Link
          href="/"
          className="neon-button green mt-6"
          onClick={() => rememberDestination(path)}
        >
          {t("Войти через Google")}
        </Link>
      </main>
    );
  if (!data?.profile)
    return (
      <main className="ballers-shell">
        <AppHeader />
        <p className="error-panel">
          {error
            ? t("Не удалось загрузить профиль. Повтори проверку.")
            : t("Сначала создай или открой свой Baller ID.")}
        </p>
        {error ? (
          <button className="neon-button" onClick={() => void refresh()}>
            {t("Повторить")}
          </button>
        ) : (
          <Link
            className="neon-button"
            href="/onboarding"
            onClick={() => rememberDestination(path)}
          >
            {t("Создать профиль")}
          </Link>
        )}
      </main>
    );
  return (
    <main className="ballers-shell">
      <AppHeader />
      {children}
      <BottomNav />
    </main>
  );
}
export function CitySelect({
  value,
  onChange,
  all = false,
  id = "network-city",
}: {
  value: string;
  onChange: (s: string) => void;
  all?: boolean;
  id?: string;
}) {
  useLocale();
  const key = cityKey(value);
  const isOther = !!key && !cities.includes(key as (typeof cities)[number]);
  return (
    <div className="network-field">
      <label htmlFor={id}>{t("Город игры")}</label>
      <select
        id={id}
        value={isOther ? "__other" : key}
        onChange={(e) => onChange(e.target.value)}
      >
        {all && <option value="">{t("Все города")}</option>}
        {cities.map((c) => (
          <option key={c} value={c}>
            {cityLabel(c)}
            {c !== "Astana" ? " · " + t("Скоро") : ""}
          </option>
        ))}
        <option value="__other">{t("Другой город")}</option>
      </select>
      {isOther && (
        <input
          aria-label={t("Название города")}
          required
          minLength={2}
          maxLength={80}
          value={key === "__other" ? "" : key}
          onChange={(e) => onChange(e.target.value || "__other")}
          placeholder={t("Название города")}
        />
      )}
    </div>
  );
}
export function PersonRow({
  person,
  children,
}: {
  person: Person;
  children?: React.ReactNode;
}) {
  useLocale();
  return (
    <div className="directory-person">
      <Link className="directory-identity" href={`/players/${person.id}`}>
        <Avatar name={personName(person)} src={person.avatar_url} />
        <div>
          <b>{personName(person)}</b>
          <p className="ballers-muted">
            Baller #{person.baller_id}
            {person.primary_position
              ? " · " + positionLabel(person.primary_position)
              : ""}
          </p>
          {person.city && (
            <p className="ballers-muted">{cityLabel(person.city)}</p>
          )}
        </div>
      </Link>
      {children || <Icon name="chevron" size={18} />}
    </div>
  );
}
export function NetworkError({
  error,
  retry,
}: {
  error: string;
  retry?: () => void;
}) {
  useLocale();
  return error ? (
    <div className="error-panel" role="alert">
      <p>{t(error)}</p>
      {retry && (
        <button className="text-link" onClick={retry}>
          {t("Повторить")}
        </button>
      )}
    </div>
  ) : null;
}
export function MyTeams() {
  useLocale();
  const { data: home } = useApp();
  const { data, error } = useNetworkResource<NetworkData>(
    "ballers_network",
    {},
    !!home?.profile,
  );
  if (error)
    return (
      <Link className="search-panel" href="/discover">
        <Icon name="search" />
        <b>{t("Найти игроков и команды →")}</b>
      </Link>
    );
  return (
    <section>
      <div className="section-heading">
        <h2>{t("Твои команды")}</h2>
        <Link className="text-link" href="/discover?kind=teams">
          {t("Найти →")}
        </Link>
      </div>
      {data?.teams.slice(0, 2).map((tm) => (
        <Link
          className="network-card compact"
          key={tm.id}
          href={`/teams/${tm.id}`}
        >
          <span className="team-mark">{tm.name.slice(0, 2).toUpperCase()}</span>
          <div>
            <b>{tm.name}</b>
            <p className="ballers-muted">
              {cityLabel(tm.city)} · {t(tm.captain ? "Ответственный" : "Игрок")}
            </p>
          </div>
          <Icon name="chevron" size={18} />
        </Link>
      ))}
      {!data?.teams.length && (
        <Link href="/discover" className="network-card">
          <b>{t("Команды пока нет? Это нормально.")}</b>
          <p className="ballers-muted mt-2">
            {t("Найди свою или начни с открытой игры.")}
          </p>
          <span className="text-link">{t("Найти команду →")}</span>
        </Link>
      )}
      {data && !data.preferences && (
        <Link href="/profile/football" className="text-link mt-3">
          {t("Укажи город и готовность к приглашениям →")}
        </Link>
      )}
    </section>
  );
}
export function FootballWelcome() {
  useLocale();
  const { data: home } = useApp();
  const { data } = useNetworkResource<NetworkData>(
    "ballers_network",
    {},
    !!home?.profile,
  );
  if (
    !data ||
    data.preferences ||
    home?.games.length ||
    home?.communities.length
  )
    return null;
  return (
    <Link href="/profile/football" className="network-card">
      <p className="eyebrow">{t("Твой старт в BALLERS")}</p>
      <h2 className="mt-2">{t("Ищешь команду или просто хочешь играть?")}</h2>
      <p className="ballers-muted mt-2">
        {t(
          "Укажи город и свой статус. Команда для первой игры не обязательна.",
        )}
      </p>
      <span className="text-link">{t("Настроить мой футбол →")}</span>
    </Link>
  );
}
