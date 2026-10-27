"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useNetworkResource } from "@/lib/use-network";
import { networkRpc, changed, networkError } from "@/lib/network";
import { t } from "@/lib/i18n";
import { useLocale } from "./Language";
type Request = {
  id: string;
  player_id: string;
  first_name: string;
  last_name: string | null;
  display_name: string | null;
  baller_id: number;
  status: string;
};
type Feed = { mode: string; manager: boolean; requests: Request[] };
export default function DayRequests({
  gameId,
  open,
}: {
  gameId: string;
  open: boolean;
}) {
  useLocale();
  const r = useNetworkResource<Feed>("ballers_day_requests_feed", {
    p_game: gameId,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const reload = r.reload;
  useEffect(() => {
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 10000);
    return () => clearInterval(poll);
  }, [reload]);
  async function action(name: string, args: Record<string, unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await networkRpc(name, args);
      await r.reload();
      changed();
      window.dispatchEvent(new Event("ballers:data-changed"));
    } catch (e) {
      setError(networkError(e));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  return (
    <section
      className="neon-panel mb-4"
      aria-label={t("Заявки на игровой день")}
    >
      <h2 className="text-xl font-bold">{t("Заявки на игровой день")}</h2>
      {(error || r.error) && (
        <p role="alert" className="error-panel">
          {error || r.error}
          <button className="text-link" onClick={() => void r.reload()}>
            {t("Повторить")}
          </button>
        </p>
      )}
      {r.loading && !r.data && <p>{t("Загружаем…")}</p>}
      {r.data && (
        <>
          {r.data.manager && (
            <label className="block my-3">
              {t("Режим записи")}
              <select
                className="network-input"
                value={r.data.mode}
                disabled={busy || !open}
                onChange={(e) =>
                  void action("ballers_day_join_mode", {
                    p_game: gameId,
                    p_mode: e.target.value,
                  })
                }
              >
                <option value="APPROVAL">
                  {t("По подтверждению организатора")}
                </option>
                <option value="AUTO">{t("Свободная запись")}</option>
              </select>
            </label>
          )}
          <p className="ballers-muted my-3">
            {r.data.mode === "APPROVAL"
              ? t(
                  "До принятия заявки место не занято. При нехватке мест — очередь.",
                )
              : t(
                  "Свободная запись: при наличии места игрок сразу получает статус «Иду».",
                )}
          </p>
          {!r.data.requests.length && (
            <p className="ballers-muted">{t("Нет ожидающих заявок.")}</p>
          )}
          {r.data.requests.map((x) => (
            <article className="protocol-card" key={x.id}>
              <Link className="text-link" href={"/players/" + x.player_id}>
                {x.display_name ||
                  [x.first_name, x.last_name].filter(Boolean).join(" ")}{" "}
                · Baller #{x.baller_id}
              </Link>
              <p className="ballers-muted mt-2">
                {t(
                  (
                    {
                      PENDING: "Ожидает решения организатора",
                      ACCEPTED: "Заявка принята. Проверь состав или очередь.",
                      REJECTED: "Заявка отклонена",
                      CANCELLED: "Заявка отменена",
                    } as Record<string, string>
                  )[x.status] || "Ожидание",
                )}
              </p>
              {x.status === "PENDING" && open && (
                <div className="network-actions">
                  {r.data!.manager ? (
                    <>
                      <button
                        className="neon-button green"
                        disabled={busy}
                        onClick={() =>
                          void action("ballers_answer_day", {
                            p_request: x.id,
                            p_accept: true,
                          })
                        }
                      >
                        {t("Принять")}
                      </button>
                      <button
                        className="network-secondary"
                        disabled={busy}
                        onClick={() =>
                          void action("ballers_answer_day", {
                            p_request: x.id,
                            p_accept: false,
                          })
                        }
                      >
                        {t("Отклонить")}
                      </button>
                    </>
                  ) : (
                    <button
                      className="network-secondary"
                      disabled={busy}
                      onClick={() =>
                        void action("ballers_set_attendance", {
                          p_game_id: gameId,
                          p_player_id: x.player_id,
                          p_status: "DECLINED",
                        })
                      }
                    >
                      {t("Отозвать заявку")}
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
        </>
      )}
    </section>
  );
}
