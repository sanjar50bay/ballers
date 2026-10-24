"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useApp } from "@/app/components/AppState";
import { useLocale } from "@/app/components/Language";
import {
  CitySelect,
  NetworkShell,
  NetworkError,
  useNetworkResource,
} from "@/app/components/Network";
import { t } from "@/lib/i18n";
import {
  cityKey,
  networkRpc,
  networkError,
  changed,
  type NetworkData,
  type SearchStatus,
} from "@/lib/network";
export default function Page() {
  useLocale();
  const { data: home, refresh } = useApp();
  const net = useNetworkResource<NetworkData>(
    "ballers_network",
    {},
    !!home?.profile,
  );
  const [city, setCity] = useState("Astana"),
    [status, setStatus] = useState<SearchStatus>("PLAY"),
    [available, setAvailable] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const initial = useRef(false),
    lock = useRef(false);
  useEffect(() => {
    if (home?.profile && net.data && !initial.current) {
      initial.current = true;
      setCity(cityKey(home.profile.city) || "Astana");
      setStatus(net.data.preferences?.search_status || "PLAY");
      setAvailable(net.data.preferences?.available ?? true);
    }
  }, [home, net.data]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await networkRpc("ballers_football_save", {
        p_city: city,
        p_status: status,
        p_available: available,
      });
      changed();
      await refresh();
      setSaved(true);
    } catch (e) {
      setError(networkError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <NetworkShell>
      <Link href="/profile" className="text-link">
        {t("← Профиль")}
      </Link>
      <h1 className="page-title">{t("Твой футбол")}</h1>
      <p className="ballers-muted mb-6">
        {t(
          "Один Baller ID во всех городах. При переезде история и статистика остаются с тобой.",
        )}
      </p>
      <NetworkError
        error={error || net.error}
        retry={() => void net.reload()}
      />
      {saved && (
        <p role="status" className="network-success">
          {t("Изменения сохранены.")}
        </p>
      )}
      {net.data && (
        <form className="network-form" onSubmit={(e) => void save(e)}>
          <CitySelect value={city} onChange={setCity} />
          <fieldset className="status-options">
            <legend>{t("Как ты хочешь играть?")}</legend>
            {[
              ["LOOKING", "Ищу команду", "Хочу найти постоянный состав"],
              [
                "HAVE_TEAM",
                "Есть команда",
                "Найду её в каталоге и подам заявку",
              ],
              ["PLAY", "Хочу играть", "Без обязательного вступления в команду"],
            ].map(([value, label, help]) => (
              <label key={value} className={status === value ? "selected" : ""}>
                <input
                  type="radio"
                  name="football-status"
                  value={value}
                  checked={status === value}
                  onChange={() => setStatus(value as SearchStatus)}
                />
                <div>
                  <b>{t(label)}</b>
                  <p className="ballers-muted">{t(help)}</p>
                </div>
              </label>
            ))}
          </fieldset>
          <label className="network-check">
            <input
              type="checkbox"
              checked={available}
              onChange={(e) => setAvailable(e.target.checked)}
            />
            {t("Готов к приглашениям на игры")}
          </label>
          <p className="ballers-muted">
            {t(
              "Статус виден участникам BALLERS. Выбор «Есть команда» не подтверждает членство — его подтверждает ответственный.",
            )}
          </p>
          <button
            className="neon-button green w-full"
            disabled={busy || net.loading || !net.data}
          >
            {t(busy ? "Сохраняем…" : "Сохранить")}
          </button>
        </form>
      )}
      {status === "HAVE_TEAM" && (
        <Link className="text-link mt-5" href="/discover?kind=teams">
          {t("Найти свою команду →")}
        </Link>
      )}
    </NetworkShell>
  );
}
