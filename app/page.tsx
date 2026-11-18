"use client";
import { t as tx, uiError, positionLabel } from "@/lib/i18n";

import { useLocale } from "@/app/components/Language";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LandingPage from "./components/LandingPage";
import WelcomeCard from "./components/WelcomeCard";
import { useApp } from "./components/AppState";
import { GuideInvite } from "./components/Coach";
import Avatar from "./components/Avatar";
import GameCard from "./components/GameCard";
import { nextPlayerGame } from "@/lib/player-home";
import PlayerStats from "./components/PlayerStats";
import Icon from "./components/Icon";
import { MyTeams, FootballWelcome } from "./components/Network";
export default function Home() {
  useLocale();

  const { data, session, loading, error, refresh } = useApp();
  const router = useRouter();
  useEffect(() => {
    if (session && data && !data.profile) router.replace("/onboarding");
  }, [session, data, router]);
  useEffect(() => {
    if (!session || !data?.profile) return;
    try {
      const destination = localStorage.getItem("ballers:network-return");
      if (
        destination &&
        (/^\/teams\/[a-f0-9-]{36}$/.test(destination) ||
          destination === "/discover")
      ) {
        localStorage.removeItem("ballers:network-return");
        router.replace(destination);
      }
    } catch {}
  }, [session, data, router]);
  if (loading)
    return (
      <main className="ballers-shell">
        <div className="inline-loading">{tx("Загружаем BALLERS…")}</div>
      </main>
    );
  if (!session) return <LandingPage error={error} />;
  if (!data?.profile)
    return (
      <main className="ballers-shell">
        <p className="error-panel">
          {error ? uiError(error) : tx("Открываем профиль…")}
        </p>
        <button className="neon-button" onClick={() => void refresh()}>
          {tx("Повторить загрузку")}
        </button>
      </main>
    );
  const profile = data.profile,
    name = profile.display_name || profile.first_name;
  const game = nextPlayerGame(data.games);
  return (
    <main className="ballers-shell">
      <Link
        href="/profile"
        className="profile-strip home-profile-strip"
        data-coach="profile"
      >
        <Avatar src={profile.avatar_url} name={name} />
        <div>
          <p className="ballers-muted">{tx("Хорошей игры,")}</p>
          <h1 title={name}>{name}</h1>
          <p className="ballers-muted">
            Baller #{profile.baller_id} · {profile.city || tx("Твой город")} ·{" "}
            {positionLabel(profile.primary_position)}
          </p>
        </div>
        <Icon name="chevron" size={20} />
      </Link>
      {error && (
        <p role="alert" className="error-panel">
          {tx("Данные могут быть устаревшими.")}{" "}
          <button onClick={() => void refresh()}>{tx("Повторить")}</button>
        </p>
      )}
      <div className="section-heading">
        <h2>{tx("Ближайшая игра")}</h2>
        <Link className="text-link" href="/my-game">
          {tx("Все мои игры →")}
        </Link>
      </div>
      {game ? (
        <GameCard game={game} featured />
      ) : (
        <section className="neon-panel">
          <h3 className="font-bold">
            {tx(
              error
                ? "Не удалось проверить ближайшие игры"
                : "Ты пока не записан на ближайшие игры",
            )}
          </h3>
          <div className="network-actions mt-4">
            <Link href="/open-games" className="neon-button">
              {tx("Найти игру →")}
            </Link>
            <Link href="/create" className="network-secondary">
              {tx("Создать игровой день →")}
            </Link>
          </div>
        </section>
      )}
      {game && (
        <Link href="/open-games" className="search-panel">
          <span className="search-icon">
            <Icon name="search" />
          </span>
          <div className="flex-1">
            <b>{tx("Хочется ещё футбола?")}</b>
            <p className="ballers-muted">
              {tx("Найти ещё игру")}
              {profile.city ? ` · ${profile.city}` : ""}
            </p>
          </div>
          <Icon name="chevron" size={18} />
        </Link>
      )}
      <div className="section-heading">
        <h2>{tx("Твои сообщества")}</h2>
        <Link className="text-link" href="/discover?kind=communities">
          {tx("Все сообщества →")}
        </Link>
      </div>
      {data.communities.slice(0, 2).map((c) => (
        <Link
          key={c.id}
          href={`/communities/${c.id}`}
          className="community-row"
        >
          <span className="community-initial">
            {c.name
              .split(/\s+/)
              .slice(0, 2)
              .map((w) => w[0])
              .join("")}
          </span>
          <div>
            <b>{c.name}</b>
            <p className="ballers-muted">
              {c.city || tx("Сообщество")} ·{" "}
              {c.role === "OWNER" ? tx("организатор") : tx("участник")}
            </p>
          </div>
          <Icon name="chevron" size={18} />
        </Link>
      ))}
      {!data.communities.length && (
        <Link className="text-link" href="/discover?kind=communities">
          {tx("Найти своё сообщество →")}
        </Link>
      )}
      <MyTeams />
      <details className="home-more">
        <summary>{tx("Моя статистика")}</summary>
        <PlayerStats playerId={profile.id} compact />
      </details>
      <GuideInvite />
      <FootballWelcome />
      <WelcomeCard profile={profile} stats={data.stats} />
    </main>
  );
}
