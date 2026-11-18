"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useLocale } from "@/app/components/Language";
import { useApp } from "@/app/components/AppState";
import {
  NetworkShell,
  NetworkError,
  useNetworkResource,
} from "@/app/components/Network";
import { changed, networkError } from "@/lib/network";
import { supabase } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import {
  readSchedule,
  saveSchedule,
  type ScheduleDraft,
  type ScheduleOperation,
  type TeamCalendar,
} from "@/lib/team-calendar";

export default function Page() {
  const params = useParams<{ id: string }>();
  const { session } = useApp();
  return (
    <ScheduleTeamGame
      key={params.id + ":" + (session?.user.id || "anonymous")}
      teamId={params.id}
    />
  );
}
function ScheduleTeamGame({ teamId }: { teamId: string }) {
  useLocale();
  const router = useRouter(),
    { data: home, refresh } = useApp();
  const resource = useNetworkResource<TeamCalendar>(
    "ballers_team_calendar",
    { p_team: teamId },
    !!home?.profile,
  );
  const [draft, setDraft] = useState<ScheduleDraft>({
    community: "",
    date: "",
    time: "20:00",
    venue: "",
  });
  const [pending, setPending] = useState<ScheduleOperation | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const actor = home?.profile?.id;
  useEffect(() => {
    if (!actor) return;
    const timer = setTimeout(() => {
      const p = readSchedule(teamId, actor);
      if (p) {
        setPending(p);
        setDraft(p.draft);
      }
      setReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [teamId, actor]);
  const selected = resource.data?.communities.find(
    (c) => c.id === (draft.community || resource.data?.communities[0]?.id),
  );
  const update = (key: keyof ScheduleDraft, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !actor || !ready) return;
    const stored = pending || readSchedule(teamId, actor);
    const request = stored || {
      id: crypto.randomUUID(),
      draft: {
        ...draft,
        community: selected?.id || "",
        venue: draft.venue.trim(),
      },
    };
    if (
      !stored &&
      (!request.draft.community ||
        !request.draft.date ||
        !request.draft.time ||
        !request.draft.venue)
    ) {
      setError(t("Выбери дату, время, место и сообщество."));
      return;
    }
    saveSchedule(teamId, actor, request);
    setPending(request);
    setDraft(request.draft);
    setError("");
    lock.current = true;
    setBusy(true);
    try {
      const result = await supabase
        .rpc("ballers_schedule_team_game", {
          p_team: teamId,
          p_operation: request.id,
          p_community: request.draft.community,
          p_date: request.draft.date,
          p_time: request.draft.time,
          p_venue: request.draft.venue,
        })
        .abortSignal(AbortSignal.timeout(15000));
      if (result.error) {
        if (
          result.error.code === "P0001" ||
          result.error.code?.startsWith("22")
        ) {
          saveSchedule(teamId, actor, null);
          setPending(null);
          setError(networkError(result.error));
        } else
          setError(
            t(
              "Ответ не получен. Нажми «Проверить создание»: повтор использует тот же запрос.",
            ),
          );
        return;
      }
      if (typeof result.data !== "string") {
        setError(
          t(
            "Ответ не получен. Нажми «Проверить создание»: повтор использует тот же запрос.",
          ),
        );
        return;
      }
      saveSchedule(teamId, actor, null);
      setPending(null);
      changed();
      void refresh();
      router.push(`/games/${result.data}/play?tab=overview`);
    } catch {
      setError(
        t(
          "Ответ не получен. Нажми «Проверить создание»: повтор использует тот же запрос.",
        ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <NetworkShell>
      <h1 className="page-title mt-5">{t("Запланировать игру")}</h1>
      {resource.data && (
        <p className="ballers-muted mb-5">{resource.data.team_name}</p>
      )}
      <NetworkError
        error={resource.error}
        retry={() => void resource.reload()}
      />
      {resource.loading && !resource.data && (
        <p role="status">{t("Загружаем…")}</p>
      )}
      {resource.data && !resource.data.can_plan && (
        <p className="neon-panel">
          {t("Планировать игры команды может её ответственный.")}
        </p>
      )}
      {resource.data?.can_plan &&
        !resource.data.communities.length &&
        !pending && (
          <section className="network-card">
            <h2>{t("Где собирается ваша компания?")}</h2>
            <p className="ballers-muted my-3">
              {t(
                "Для своей игры создай сообщество. После этого вернёмся к выбору даты.",
              )}
            </p>
            <Link
              className="neon-button green"
              href={`/communities/create?team=${teamId}`}
            >
              {t("Создать своё сообщество")}
            </Link>
          </section>
        )}
      {resource.data?.can_plan &&
        (!!resource.data.communities.length || !!pending) && (
          <form className="network-form mt-5" onSubmit={submit}>
            {error && (
              <p role="alert" className="error-panel">
                {error}
              </p>
            )}
            {pending && (
              <p role="status" className="neon-panel">
                {t(
                  "Проверяем создание игры с прежними датой и временем.",
                )}
              </p>
            )}
            <label className="network-field">
              <span>{t("Сообщество")}</span>
              <select
                aria-label={t("Сообщество")}
                value={draft.community || selected?.id || ""}
                disabled={busy || !!pending}
                onChange={(e) => update("community", e.target.value)}
                required
              >
                {pending &&
                  !resource.data.communities.some(
                    (c) => c.id === pending.draft.community,
                  ) && (
                    <option value={pending.draft.community}>
                      {t("Выбранное сообщество")}
                    </option>
                  )}
                {resource.data.communities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="network-field">
              <span>{t("Дата")}</span>
              <input
                type="date"
                required
                disabled={busy || !!pending}
                value={draft.date}
                onChange={(e) => update("date", e.target.value)}
              />
            </label>
            <label className="network-field">
              <span>{t("Время начала")}</span>
              <input
                type="time"
                required
                disabled={busy || !!pending}
                value={draft.time}
                onChange={(e) => update("time", e.target.value)}
              />
            </label>
            <label className="network-field">
              <span>{t("Место")}</span>
              <input
                required
                maxLength={160}
                disabled={busy || !!pending}
                value={draft.venue}
                onChange={(e) => update("venue", e.target.value)}
                placeholder={t("Название поля или адрес")}
              />
            </label>
            {selected && (
              <p className="ballers-muted">
                {selected.format}×{selected.format} ·{" "}
                {t("Команд: {count}", { count: selected.team_count })} ·{" "}
                {t("Мест: {count}", { count: selected.capacity ?? "∞" })}
              </p>
            )}
            {selected && !selected.linked && (
              <p className="ballers-muted text-sm">
                {t(
                  "Свяжем команду с выбранным сообществом, которым ты управляешь.",
                )}
              </p>
            )}
            <p className="ballers-muted text-sm">
              {t(
                "Подтверждённый состав получит приглашения. Каждый сам ответит, идёт ли он. Поле нужно согласовать отдельно.",
              )}
            </p>
            <button
              className="neon-button green w-full"
              disabled={busy || !ready}
            >
              {t(
                busy
                  ? "Сохраняем…"
                  : pending
                    ? "Проверить создание"
                    : "Создать игру и пригласить состав",
              )}
            </button>
          </form>
        )}
    </NetworkShell>
  );
}
