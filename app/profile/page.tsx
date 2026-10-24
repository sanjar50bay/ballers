"use client";
import { t as tx, uiError, positionLabel } from "@/lib/i18n";

import { useLocale } from "@/app/components/Language";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useApp } from "../components/AppState";
import AppHeader from "../components/AppHeader";
import BottomNav from "../components/BottomNav";
import PlayerStats from "../components/PlayerStats";
import { PlayerCard } from "../components/WelcomeCard";
import Avatar from "../components/Avatar";
export default function ProfilePage() {
  useLocale();

  const { data, session, loading, refresh, error } = useApp();
  const [welcome, setWelcome] = useState(true),
    [busy, setBusy] = useState(false),
    [signError, setSignError] = useState("");
  const [preview, setPreview] = useState(false);
  const router = useRouter();
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        setWelcome(localStorage.getItem("ballers:welcome:disabled") !== "true");
      } catch {}
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  async function logout() {
    setBusy(true);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setSignError(tx("Не удалось выйти. Попробуй снова."));
      setBusy(false);
      return;
    }
    await refresh();
    router.replace("/");
  }
  const p = data?.profile;
  return (
    <main className="ballers-shell">
      <AppHeader />
      <h1 className="page-title">{tx("Твой Baller ID")}</h1>
      <p className="ballers-muted mb-6">{tx("Карьера и настройки")}</p>
      {loading ? (
        <p className="inline-loading">{tx("Загружаем профиль…")}</p>
      ) : p ? (
        <>
          <div className="profile-strip">
            <Avatar name={p.display_name || p.first_name} src={p.avatar_url} />
            <div>
              <h2 className="text-2xl font-bold">
                {p.display_name || p.first_name}
              </h2>
              <p className="ballers-muted">
                Baller #{p.baller_id} · {p.city} ·{" "}
                {positionLabel(p.primary_position)}
              </p>
            </div>
          </div>
          <button
            className="neon-button w-full mt-4"
            onClick={() => setPreview(true)}
          >
            {tx("Показать мою карточку")}
          </button>
          {preview && (
            <PlayerCard
              manual
              profile={p}
              stats={data?.stats ?? undefined}
              onClose={() => setPreview(false)}
            />
          )}
          <Link className="search-panel" href="/profile/football">
            <div>
              <b>{tx("Город, команда и приглашения")}</b>
              <p className="ballers-muted">{tx("Как ты хочешь играть?")}</p>
            </div>
          </Link>
          <Link className="text-link" href="/discover?kind=inbox">
            {tx("Командные запросы →")}
          </Link>
          <PlayerStats playerId={p.id} />
          <Link className="neon-button blue w-full" href="/career">
            {tx("Моя история матчей →")}
          </Link>
          <Link className="community-row text-[#cbaaff]" href="/profile/edit">
            {tx("Настройки профиля →")}
          </Link>
          <section className="neon-panel mt-3">
            <label className="flex items-center gap-3 min-h-11">
              <input
                type="checkbox"
                checked={welcome}
                onChange={(e) => {
                  setWelcome(e.target.checked);
                  try {
                    localStorage.setItem(
                      "ballers:welcome:disabled",
                      String(!e.target.checked),
                    );
                  } catch {}
                }}
              />
              {tx("Карточка игрока при входе")}
            </label>
            <p className="ballers-muted mt-2">
              {tx(
                "При возвращении после 30 минут. Показ — до 5 секунд, можно сразу пропустить.",
              )}
            </p>
          </section>
          <button
            className="text-link mt-5"
            disabled={busy}
            onClick={() => void logout()}
          >
            {tx("Выйти из аккаунта")}
          </button>
          {signError && (
            <p role="alert" className="error-panel">
              {uiError(signError)}
            </p>
          )}
        </>
      ) : (
        <div className="error-panel">
          {(error ? uiError(error) : "") ||
            (session
              ? tx("Профиль ещё не создан.")
              : tx("Войди, чтобы открыть профиль."))}
          <Link className="text-link" href={session ? "/onboarding" : "/"}>
            {tx("Продолжить →")}
          </Link>
        </div>
      )}
      <BottomNav />
    </main>
  );
}
