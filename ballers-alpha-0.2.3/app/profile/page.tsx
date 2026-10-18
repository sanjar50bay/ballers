"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useApp } from "../components/AppState";
import AppHeader from "../components/AppHeader";
import BottomNav from "../components/BottomNav";
import PlayerStats from "../components/PlayerStats";
import Avatar from "../components/Avatar";
export default function ProfilePage() {
  const { data, session, loading, refresh, error } = useApp();
  const [welcome, setWelcome] = useState(true),
    [busy, setBusy] = useState(false),
    [signError, setSignError] = useState("");
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
      setSignError("Не удалось выйти. Попробуй снова.");
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
      <h1 className="page-title">Твой Baller ID</h1>
      <p className="ballers-muted mb-6">Карьера и настройки</p>
      {loading ? (
        <p className="inline-loading">Загружаем профиль…</p>
      ) : p ? (
        <>
          <div className="profile-strip">
            <Avatar name={p.display_name || p.first_name} src={p.avatar_url} />
            <div>
              <h2 className="text-2xl font-bold">
                {p.display_name || p.first_name}
              </h2>
              <p className="ballers-muted">
                Baller #{p.baller_id} · {p.city} · {p.primary_position}
              </p>
            </div>
          </div>
          <PlayerStats playerId={p.id} />
          <Link className="neon-button blue w-full" href="/career">
            Моя история матчей →
          </Link>
          <Link className="community-row text-[#cbaaff]" href="/profile/edit">
            Настройки профиля →
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
              Карточка игрока при входе
            </label>
            <p className="ballers-muted mt-2">
              Не чаще одного раза в день. Можно сразу пропустить.
            </p>
          </section>
          <button
            className="text-link mt-5"
            disabled={busy}
            onClick={() => void logout()}
          >
            Выйти из аккаунта
          </button>
          {signError && (
            <p role="alert" className="error-panel">
              {signError}
            </p>
          )}
        </>
      ) : (
        <div className="error-panel">
          {error ||
            (session
              ? "Профиль ещё не создан."
              : "Войди, чтобы открыть профиль.")}
          <Link className="text-link" href={session ? "/onboarding" : "/"}>
            Продолжить →
          </Link>
        </div>
      )}
      <BottomNav />
    </main>
  );
}
