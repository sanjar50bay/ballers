"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { useLocale } from "@/app/components/Language";
import { useApp } from "@/app/components/AppState";
import { NetworkShell } from "@/app/components/Network";
import { supabase } from "@/lib/supabase";

export default function CreateCommunityPage() {
  useLocale();
  const router = useRouter();
  const { refresh } = useApp();
  const lock = useRef(false);
  const [name, setName] = useState(""),
    [city, setCity] = useState("Astana"),
    [mode, setMode] = useState("RANDOM"),
    [format, setFormat] = useState("5"),
    [teams, setTeams] = useState("3"),
    [capacity, setCapacity] = useState("15");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [uncertain, setUncertain] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (lock.current || uncertain) return;
    setError("");
    if (!name.trim()) {
      setError("Введи название сообщества.");
      return;
    }
    if (name.trim().length > 120) {
      setError("Название должно быть не длиннее 120 символов.");
      return;
    }
    if (
      !Number.isInteger(+teams) ||
      +teams < 2 ||
      +teams > 8 ||
      !Number.isInteger(+format) ||
      +format < 1 ||
      +format > 11 ||
      (capacity !== "" && (!Number.isSafeInteger(+capacity) || +capacity < 1))
    ) {
      setError("Проверь количество команд и мест.");
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      // One authoritative RPC: no redundant getUser/profile round trips. Server checks auth/role.
      const { data, error } = await supabase
        .rpc("ballers_create_community", {
          p_name: name.trim(),
          p_city: city.trim(),
          p_team_mode: mode,
          p_format: +format,
          p_team_count: +teams,
          p_capacity: capacity ? +capacity : null,
        })
        .abortSignal(AbortSignal.timeout(15000));
      if (error) {
        if (!error.code || /abort|timeout|fetch|network/i.test(error.message)) {
          setUncertain(true);
          setError(
            "Не удалось подтвердить создание. Проверь «Мои сообщества» перед повторной попыткой: запись могла сохраниться.",
          );
        } else
          setError(
            "Не удалось создать сообщество. Проверь данные и доступ к аккаунту.",
          );
        return;
      }
      void refresh();
      router.push(
        typeof data === "string" ? `/communities/${data}` : "/communities",
      );
    } catch {
      setUncertain(true);
      setError(
        "Не удалось подтвердить создание. Проверь «Мои сообщества» перед повторной попыткой: запись могла сохраниться.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <NetworkShell>
      <Link
        className="text-link"
        href="/communities"
        onClick={() => void refresh()}
      >
        {t("← Мои сообщества")}
      </Link>
      <h1 className="page-title mt-5">{t("Create Community")}</h1>
      <p className="ballers-muted mb-6">
        {t(
          "Одно сообщество — общая компания. Играть можно в разные дни и на разных аренах.",
        )}
      </p>
      <form className="network-form" onSubmit={submit}>
        {error && (
          <p className="error-panel" role="alert">
            {t(error)}
          </p>
        )}
        {uncertain && (
          <Link
            className="text-link"
            href="/communities"
            onClick={() => void refresh()}
          >
            {t("Проверить мои сообщества →")}
          </Link>
        )}
        <fieldset className="network-form" disabled={busy || uncertain}>
          <label className="network-field" htmlFor="community-name">
            <span id="community-name-label">{t("Название сообщества")}</span>
            <input
              id="community-name"
              aria-labelledby="community-name-label"
              className="network-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("Назови своё сообщество")}
              maxLength={120}
              required
              aria-describedby="community-name-hint"
            />
            <small id="community-name-hint" className="ballers-muted">
              {t("Например: «Достар Астана» или «Футбол для своих».")}
            </small>
          </label>
          <label className="network-field" htmlFor="community-city">
            <span>{t("Город")}</span>
            <input
              id="community-city"
              className="network-input"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              maxLength={100}
            />
          </label>
          <label className="network-field" htmlFor="community-mode">
            <span>{t("Распределение по командам")}</span>
            <select
              id="community-mode"
              className="network-input"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="RANDOM">
                {t("Случайное распределение по командам")}
              </option>
              <option value="FIXED">{t("Fixed teams")}</option>
              <option value="MIXED">{t("Mixed")}</option>
            </select>
          </label>
          <label className="network-field" htmlFor="community-format">
            <span>{t("Формат игры")}</span>
            <select
              id="community-format"
              className="network-input"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
            >
              {Array.from({ length: 11 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}×{n}
                </option>
              ))}
            </select>
          </label>
          <label className="network-field" htmlFor="community-teams">
            <span>{t("Количество команд")}</span>
            <input
              id="community-teams"
              className="network-input"
              type="number"
              min="2"
              max="8"
              step="1"
              value={teams}
              onChange={(e) => setTeams(e.target.value)}
              required
            />
          </label>
          <label className="network-field" htmlFor="community-capacity">
            <span id="community-capacity-label">
              {t("Мест на игровой день по умолчанию")}
            </span>
            <input
              id="community-capacity"
              aria-labelledby="community-capacity-label"
              className="network-input"
              type="number"
              min="1"
              step="1"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              aria-describedby="community-capacity-hint"
            />
            <small id="community-capacity-hint" className="ballers-muted">
              {t(
                "Не ограничивает число участников сообщества. Для каждого игрового дня можно задать своё количество мест. Пусто — без лимита.",
              )}
            </small>
          </label>
          <button
            className="neon-button w-full"
            type="submit"
            disabled={busy || uncertain}
          >
            {t(busy ? "Creating..." : "Create Community")}
          </button>
        </fieldset>
        {busy && (
          <p role="status" className="ballers-muted">
            {t("Сохраняем сообщество…")}
          </p>
        )}
      </form>
    </NetworkShell>
  );
}
