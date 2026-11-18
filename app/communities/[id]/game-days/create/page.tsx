"use client";
import {
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useApp } from "@/app/components/AppState";
import { useLocale } from "@/app/components/Language";
import {
  NetworkShell,
  NetworkError,
  useNetworkResource,
} from "@/app/components/Network";
import { supabase } from "@/lib/supabase";
import { changed, networkError } from "@/lib/network";
import { t } from "@/lib/i18n";
import type { CommunityWorkspace } from "@/lib/community-workspace";
import {
  followingWeek,
  localDate,
  readCommunityOperation,
  saveCommunityOperation,
  type CommunityDraft,
  type CommunityOperation,
} from "@/lib/community-schedule";
const subscribe = () => () => {};
export default function Page() {
  const id = String(useParams().id),
    { session } = useApp();
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (!hydrated) return <p>…</p>;
  return (
    <Suspense fallback={<p>…</p>}>
      <Route key={id + ":" + session?.user.id} id={id} />
    </Suspense>
  );
}
function Route({ id }: { id: string }) {
  const source = useSearchParams().get("from");
  return <Plan key={id + ":" + source} id={id} source={source} />;
}
function Plan({ id, source }: { id: string; source: string | null }) {
  useLocale();
  const { data: home, refresh } = useApp(),
    router = useRouter();
  const resource = useNetworkResource<CommunityWorkspace>(
    "ballers_community_workspace",
    { p_community: id },
    !!home?.profile,
  );
  const actor = home?.profile?.id;
  const [draft, setDraft] = useState<CommunityDraft | null>(null),
    [pending, setPending] = useState<CommunityOperation | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState("");
  const lock = useRef(false),
    initialized = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const d = resource.data;
  useEffect(() => {
    if (!actor || !d || initialized.current) return;
    const timer = setTimeout(() => {
      const p = readCommunityOperation(id, actor);
      if (p) {
        setPending(p);
        setDraft(p.draft);
        initialized.current = true;
        return;
      }
      const previous = source ? d.games.find((g) => g.id === source) : null;
      if (source && !previous) {
        setError(
          t(
            "Исходная игра недоступна. Вернись в календарь и выбери игру заново.",
          ),
        );
        initialized.current = true;
        return;
      }
      setDraft({
        source: previous?.id || null,
        date: previous ? followingWeek(previous.game_date) : "",
        time: previous?.start_time?.slice(0, 5) || "20:00",
        venue: previous?.venue || "",
        format: previous?.format || d.default_format,
        teams: previous?.team_count || d.default_team_count,
        capacity: previous ? previous.capacity : d.default_capacity,
      });
      initialized.current = true;
    }, 0);
    return () => clearTimeout(timer);
  }, [actor, d, id, source]);
  const update = <K extends keyof CommunityDraft>(k: K, v: CommunityDraft[K]) =>
    setDraft((old) => (old ? { ...old, [k]: v } : old));
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (lock.current || !actor || !draft) return;
    const p = pending ||
      readCommunityOperation(id, actor) || {
        id: crypto.randomUUID(),
        draft: { ...draft, venue: draft.venue.trim() },
      };
    if (!p.draft.date || !p.draft.time || !p.draft.venue) {
      setError(t("Выбери дату, время и место."));
      return;
    }
    saveCommunityOperation(id, actor, p);
    setPending(p);
    setDraft(p.draft);
    setError("");
    setConflict("");
    lock.current = true;
    setBusy(true);
    try {
      const { data, error: err } = await supabase
        .rpc("ballers_schedule_community_game", {
          p_community: id,
          p_operation: p.id,
          p_source: p.draft.source,
          p_date: p.draft.date,
          p_time: p.draft.time,
          p_venue: p.draft.venue,
          p_format: p.draft.format,
          p_team_count: p.draft.teams,
          p_capacity: p.draft.capacity,
        })
        .abortSignal(AbortSignal.timeout(15000));
      if (!active.current) return;
      if (err) {
        if (err.code === "P0001" || err.code?.startsWith("22")) {
          saveCommunityOperation(id, actor, null);
          setPending(null);
          setError(
            err.message.includes("INVALID_SCHEDULE_SOURCE")
              ? t(
                  "Исходная игра недоступна. Вернись в календарь и выбери игру заново.",
                )
              : networkError(err),
          );
        } else
          setError(
            t(
              "Ответ не получен. Нажми «Проверить создание»: повтор использует тот же запрос.",
            ),
          );
        return;
      }
      if (
        !data ||
        typeof data.id !== "string" ||
        typeof data.created !== "boolean"
      ) {
        setError(
          t(
            "Ответ не получен. Нажми «Проверить создание»: повтор использует тот же запрос.",
          ),
        );
        return;
      }
      saveCommunityOperation(id, actor, null);
      setPending(null);
      if (!data.created) {
        setConflict(data.id);
        setError(
          t(
            "На эту дату и время в сообществе уже есть игра. Открой её или выбери другое время.",
          ),
        );
        return;
      }
      changed();
      void refresh();
      router.push(`/games/${data.id}/play?tab=overview`);
    } catch {
      if (!active.current) return;
      setError(
        t(
          "Ответ не получен. Нажми «Проверить создание»: повтор использует тот же запрос.",
        ),
      );
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <NetworkShell>
      <h1 className="page-title">
        {t(source ? "Игра на следующую неделю" : "Создать игру")}
      </h1>
      {d && <p className="ballers-muted mb-5">{d.name}</p>}
      <NetworkError
        error={resource.error}
        retry={() => void resource.reload()}
      />
      {error && (
        <p className="error-panel" role="alert">
          {error}
        </p>
      )}
      {conflict && (
        <Link
          className="neon-button mb-5"
          href={`/games/${conflict}/play?tab=overview`}
        >
          {t("Открыть существующую игру")}
        </Link>
      )}
      {resource.loading && !d && <p role="status">{t("Загружаем…")}</p>}
      {d && !d.can_manage && (
        <p className="network-card">
          {t("Создавать игры может организатор сообщества.")}
        </p>
      )}
      {d?.can_manage && draft && (
        <form className="network-form" onSubmit={submit}>
          {pending && (
            <p role="status" className="neon-panel">
              {t("Проверяем создание игры с прежними датой и временем.")}
            </p>
          )}
          <fieldset disabled={busy || !!pending} className="space-y-4">
            <label className="network-field">
              <span>{t("Дата")}</span>
              <input
                type="date"
                required
                min={pending ? undefined : localDate()}
                value={draft.date}
                onChange={(e) => update("date", e.target.value)}
              />
            </label>
            <label className="network-field">
              <span>{t("Время начала")}</span>
              <input
                type="time"
                required
                value={draft.time}
                onChange={(e) => update("time", e.target.value)}
              />
            </label>
            <label className="network-field">
              <span>{t("Место")}</span>
              <input
                required
                maxLength={160}
                placeholder={t("Название поля или адрес")}
                value={draft.venue}
                onChange={(e) => update("venue", e.target.value)}
              />
            </label>
            <p className="ballers-muted">
              {draft.format}×{draft.format} ·{" "}
              {t("Команд: {count}", { count: draft.teams })} ·{" "}
              {t("Мест: {count}", { count: draft.capacity ?? "∞" })}
            </p>
            <details>
              <summary className="text-link cursor-pointer py-3">
                {t("Изменить формат и число мест")}
              </summary>
              <label className="network-field">
                <span>{t("Игроков на поле")}</span>
                <input
                  type="number"
                  min="1"
                  max="11"
                  required
                  value={draft.format}
                  onChange={(e) => update("format", Number(e.target.value))}
                />
              </label>
              <label className="network-field">
                <span>{t("Команд")}</span>
                <input
                  type="number"
                  min="2"
                  max="8"
                  required
                  value={draft.teams}
                  onChange={(e) => update("teams", Number(e.target.value))}
                />
              </label>
              <label className="network-field">
                <span>{t("Мест на этот игровой день")}</span>
                <input
                  type="number"
                  min="1"
                  max="200"
                  placeholder={t("Без ограничения")}
                  value={draft.capacity ?? ""}
                  onChange={(e) =>
                    update(
                      "capacity",
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                />
              </label>
            </details>
          </fieldset>
          <p className="ballers-muted text-sm my-3">
            {t(
              "Новая игра: составы и ответы собираются заново. Поле не бронируется.",
            )}
          </p>
          <button disabled={busy} className="neon-button green w-full">
            {t(
              busy
                ? "Сохраняем…"
                : pending
                  ? "Проверить создание"
                  : "Создать игру",
            )}
          </button>
        </form>
      )}
    </NetworkShell>
  );
}
