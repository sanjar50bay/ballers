"use client";
import { useTeamAction } from "@/lib/use-network";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import Link from "next/link";
import { useApp, type Stats } from "@/app/components/AppState";
import { useLocale } from "@/app/components/Language";
import {
  NetworkShell,
  NetworkError,
  PersonRow,
  useNetworkResource,
} from "@/app/components/Network";
import { t } from "@/lib/i18n";
import {
  networkError,
  changed,
  searchLabel,
  type Person,
  type NetworkData,
  type TeamItem,
} from "@/lib/network";
type PublicPlayer = Person & { stats: Stats; teams: TeamItem[] };
export default function PlayerPage() {
  useLocale();
  const runTeamAction = useTeamAction();
  const id = String(useParams().id);
  const { data: home } = useApp();
  const profile = useNetworkResource<PublicPlayer>(
    "ballers_public_player",
    { p_player: id },
    !!home?.profile,
  );
  const net = useNetworkResource<NetworkData>(
    "ballers_network",
    {},
    !!home?.profile,
  );
  const [team, setTeam] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [sent, setSent] = useState(false);
  const lock = useRef(false);
  const p = profile.data;
  const captained = net.data?.teams.filter((tm) => tm.captain) || [];
  async function invite() {
    if (!team || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await runTeamAction({
        p_team: team,
        p_action: "INVITE",
        p_players: [id],
      });
      changed();
      setSent(true);
    } catch (e) {
      setError(networkError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <NetworkShell>
      <Link className="text-link" href="/discover">
        {t("← К поиску")}
      </Link>
      <NetworkError error={profile.error} retry={() => void profile.reload()} />
      {profile.loading && !p && (
        <p className="inline-loading">{t("Загружаем профиль…")}</p>
      )}
      {p && (
        <>
          <h1 className="page-title">{t("Baller ID")}</h1>
          <section className="network-card">
            <PersonRow person={p} />
            <span className="network-badge">
              {searchLabel(p.search_status || "PLAY")}
            </span>
            <p className="ballers-muted mt-3">
              {t(
                p.available === true
                  ? "Готов к приглашениям на игры"
                  : p.available === false
                    ? "Сейчас не ищет приглашений на игры"
                    : "Готовность к приглашениям пока не указана",
              )}
            </p>
          </section>
          <section className="network-card">
            <h2>{t("Учтённая статистика")}</h2>
            <div className="stats-grid mt-4">
              {[
                ["Матчи", p.stats.matches],
                ["Голы", p.stats.goals],
                ["Ассисты", p.stats.assists],
              ].map(([label, n]) => (
                <div key={label}>
                  <b>{n}</b>
                  <p>{t(String(label))}</p>
                </div>
              ))}
            </div>
            <p className="ballers-muted mt-3">
              {t("Только учтённые результаты")}
            </p>
          </section>
          <h2 className="section-title">{t("Команды игрока")}</h2>
          {p.teams.map((tm) => (
            <Link href={`/teams/${tm.id}`} className="network-card" key={tm.id}>
              <b>{tm.name}</b>
            </Link>
          ))}
          {!p.teams.length && (
            <p className="ballers-muted">
              {t("Пока без подтверждённой команды")}
            </p>
          )}
          {home?.profile?.id !== id && captained.length > 0 && (
            <section className="network-card">
              <h2>{t("Пригласить в команду")}</h2>
              <NetworkError error={error} />
              {sent && (
                <p role="status" className="network-success">
                  {t("Приглашение отправлено. Игрок подтвердит его сам.")}
                </p>
              )}
              <label className="network-field">
                <span>{t("Твоя команда")}</span>
                <select
                  value={team}
                  onChange={(e) => {
                    setTeam(e.target.value);
                    setSent(false);
                  }}
                >
                  <option value="">{t("Выбери команду")}</option>
                  {captained.map((tm) => (
                    <option value={tm.id} key={tm.id}>
                      {tm.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="neon-button green"
                disabled={!team || busy}
                onClick={() => void invite()}
              >
                {t("Отправить приглашение")}
              </button>
            </section>
          )}
        </>
      )}
    </NetworkShell>
  );
}
