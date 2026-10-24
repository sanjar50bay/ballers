"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useApp } from "@/app/components/AppState";
import { useLocale } from "@/app/components/Language";
import {
  CitySelect,
  NetworkError,
  NetworkShell,
} from "@/app/components/Network";
import { t } from "@/lib/i18n";
import { cityKey, networkRpc, networkError, changed } from "@/lib/network";
export default function Page() {
  useLocale();
  const router = useRouter();
  const { data } = useApp();
  const [name, setName] = useState(""),
    [city, setCity] = useState(""),
    [about, setAbout] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    requestId = useRef("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    requestId.current ||= crypto.randomUUID();
    try {
      const id = await networkRpc<string>("ballers_team_create", {
        p_id: requestId.current,
        p_name: name.trim(),
        p_city: city || cityKey(data?.profile?.city) || "Astana",
        p_about: about.trim(),
      });
      changed();
      router.push(`/teams/${id}`);
    } catch (e) {
      setError(networkError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <NetworkShell>
      <Link className="text-link" href="/discover?kind=teams">
        {t("← Команды")}
      </Link>
      <h1 className="page-title">{t("Создать команду")}</h1>
      <p className="ballers-muted mb-6">
        {t(
          "Один состав, своя история, несколько сообществ. Ты станешь ответственным за команду.",
        )}
      </p>
      <NetworkError error={error} />
      <form onSubmit={(e) => void save(e)} className="network-form">
        <label className="network-field">
          <span>{t("Название команды")}</span>
          <input
            required
            minLength={2}
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("Например, Барс")}
          />
        </label>
        <CitySelect
          value={city || cityKey(data?.profile?.city) || "Astana"}
          onChange={setCity}
        />
        <label className="network-field">
          <span>
            {t("О команде")} · {t("необязательно")}
          </span>
          <textarea
            rows={3}
            maxLength={500}
            value={about}
            onChange={(e) => setAbout(e.target.value)}
          />
        </label>
        <p className="ballers-muted">
          {t(
            "Игроки попадут в состав только после согласия. Создание команды не меняет результаты прежних игр.",
          )}
        </p>
        <button
          className="neon-button green w-full"
          disabled={busy || !name.trim()}
        >
          {t(busy ? "Создаём…" : "Создать команду")}
        </button>
      </form>
    </NetworkShell>
  );
}
