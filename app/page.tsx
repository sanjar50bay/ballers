"use client";
import { t as tx, uiError, positionLabel } from "@/lib/i18n";

import { useLocale } from "@/app/components/Language";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Provider } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useApp } from "./components/AppState";
import AppHeader from "./components/AppHeader";
import BottomNav from "./components/BottomNav";
import Avatar from "./components/Avatar";
import GameCard, { attendanceLabel } from "./components/GameCard";
import PlayerStats from "./components/PlayerStats";
import Icon from "./components/Icon";
import WelcomeCard from "./components/WelcomeCard";
import { MyTeams, FootballWelcome } from "./components/Network";
export default function Home() {
  useLocale();

  const { data, session, loading, error, refresh } = useApp();
  const [authError, setAuthError] = useState(""),
    [signing, setSigning] = useState(false);
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
  async function login(provider: Provider) {
    setSigning(true);
    setAuthError("");
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch (e) {
      setAuthError(
        e instanceof Error ? e.message : tx("Не удалось открыть вход"),
      );
    } finally {
      setSigning(false);
    }
  }
  if (loading)
    return (
      <main className="ballers-shell">
        <div className="inline-loading">{tx("Загружаем BALLERS…")}</div>
      </main>
    );
  if (!session)
    return (
      <main className="min-h-svh flex items-center justify-center px-6 bg-[#03050b]">
        <div className="max-w-sm w-full">
          <div className="text-[#79ffb0] mb-4">
            <Icon name="ball" size={46} />
          </div>
          <h1 className="text-5xl font-black mb-3">
            BALLERS<span className="text-[#79ffb0]">.</span>
          </h1>
          <p className="text-[#b6c7dc] mb-10">
            {tx("Твой футбол. Твоя команда.")}
          </p>
          <button
            className="provider-button"
            disabled={signing}
            onClick={() => void login("google")}
          >
            {tx("Продолжить с Google")}
          </button>
          {process.env.NEXT_PUBLIC_AUTH_APPLE_ENABLED === "true" && (
            <button
              className="provider-button"
              disabled={signing}
              onClick={() => void login("apple")}
            >
              {tx("Продолжить с Apple")}
            </button>
          )}
          {process.env.NEXT_PUBLIC_AUTH_VK_PROVIDER?.startsWith("custom:") && (
            <button
              className="provider-button"
              disabled={signing}
              onClick={() =>
                void login(process.env.NEXT_PUBLIC_AUTH_VK_PROVIDER as Provider)
              }
            >
              {tx("Продолжить с VK")}
            </button>
          )}
          <p className="ballers-muted mt-5">
            {tx(
              "Один вход — один Baller ID. В этом браузере вход сохранится автоматически.",
            )}
          </p>
          {authError && (
            <p role="alert" className="error-panel">
              {authError}
            </p>
          )}
          {error && (
            <p role="alert" className="error-panel">
              {uiError(error)}
            </p>
          )}
        </div>
      </main>
    );
  if (!data?.profile)
    return (
      <main className="ballers-shell">
        <AppHeader />
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
  const game =
    data.games.find((g) => g.attendance_status === "GOING") || data.games[0];
  return (
    <main className="ballers-shell">
      <AppHeader />
      <Link href="/profile" className="profile-strip">
        <Avatar src={profile.avatar_url} name={name} />
        <div>
          <p className="ballers-muted">{tx("Хорошей игры,")}</p>
          <h1>{name}</h1>
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
      <FootballWelcome />
      <div className="section-heading">
        <h2>{tx("Ближайший игровой день")}</h2>
        {game && <span className="status-chip">{attendanceLabel(game)}</span>}
      </div>
      {game ? (
        <GameCard game={game} />
      ) : (
        <section className="neon-panel">
          <h3 className="font-bold">{tx("Скоро здесь будет твоя игра")}</h3>
          <p className="ballers-muted mt-2">
            {tx("Выбирай открытый игровой день или собери свой.")}
          </p>
          <Link href="/open-games" className="text-link">
            {tx("Найти игру →")}
          </Link>
        </section>
      )}
      <PlayerStats playerId={profile.id} compact />
      <Link href="/open-games" className="search-panel">
        <span className="search-icon">
          <Icon name="search" />
        </span>
        <div className="flex-1">
          <b>{tx("Хочется ещё футбола?")}</b>
          <p className="ballers-muted">
            {tx("Найти игру")}
            {profile.city ? ` · ${profile.city}` : ""}
          </p>
        </div>
        <Icon name="chevron" size={18} />
      </Link>
      <div className="section-heading">
        <h2>{tx("Твои сообщества")}</h2>
        <Link className="text-link" href="/communities">
          {tx("Все →")}
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
        <Link className="text-link" href="/communities">
          {tx("Найти своё сообщество →")}
        </Link>
      )}
      <MyTeams />
      <WelcomeCard profile={profile} stats={data.stats} />
      <BottomNav />
    </main>
  );
}
