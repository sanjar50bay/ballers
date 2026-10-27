"use client";
import { useRef, useState } from "react";
import { useNetworkResource } from "@/lib/use-network";
import { networkRpc, networkError } from "@/lib/network";
import { t } from "@/lib/i18n";
import { useLocale } from "./Language";
type Person = {
  id: string;
  name?: string;
  first_name?: string;
  last_name?: string | null;
  display_name?: string | null;
};
type Dot = { player_id: string; x: number; y: number };
type Board = { layout: Dot[]; version: number };
const preset = [
  [50, 90],
  [25, 72],
  [75, 72],
  [30, 56],
  [70, 56],
];
export default function TacticalBoard({
  teamId,
  members,
  editable,
}: {
  teamId: string;
  members: Person[];
  editable: boolean;
}) {
  useLocale();
  const r = useNetworkResource<Board>("ballers_tactics", { p_team: teamId });
  return (
    <section className="neon-panel mt-4">
      <h2 className="text-xl font-bold">{t("Тактическая доска 5×5")}</h2>
      <p className="ballers-muted my-3">
        {t(
          "Твоя пятёрка против условного соперника. Расстановка не меняет состав и заявки.",
        )}
      </p>
      {r.error && (
        <p role="alert">
          {r.error}
          <button onClick={() => void r.reload()}>{t("Повторить")}</button>
        </p>
      )}
      {r.loading && !r.data && <p>{t("Загружаем…")}</p>}
      {r.data && (
        <Editor
          key={teamId + ":" + r.data.version}
          teamId={teamId}
          members={members}
          editable={editable}
          initial={r.data}
          reload={r.reload}
        />
      )}
    </section>
  );
}
function Editor({
  teamId,
  members,
  editable,
  initial,
  reload,
}: {
  teamId: string;
  members: Person[];
  editable: boolean;
  initial: Board;
  reload: () => Promise<void>;
}) {
  const [dots, setDots] = useState(initial.layout),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const field = useRef<HTMLDivElement>(null),
    drag = useRef<string | null>(null),
    lock = useRef(false);
  const name = (id: string) => {
    const p = members.find((x) => x.id === id);
    return (
      p?.name ||
      p?.display_name ||
      [p?.first_name, p?.last_name].filter(Boolean).join(" ") ||
      t("Игрок")
    );
  };
  const move = (id: string, x: number, y: number) =>
    setDots((old) =>
      old.map((p) =>
        p.player_id === id
          ? {
              ...p,
              x: Math.max(5, Math.min(95, x)),
              y: Math.max(5, Math.min(95, y)),
            }
          : p,
      ),
    );
  async function save() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    try {
      await networkRpc("ballers_tactics", {
        p_team: teamId,
        p_layout: dots,
        p_version: initial.version,
      });
      await reload();
    } catch (e) {
      setNotice(networkError(e));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  return (
    <>
      <div
        className="tactical-pitch"
        ref={field}
        aria-label={t("Футбольное поле")}
      >
        <div className="pitch-line" />
        <div className="pitch-circle" />
        {[
          [25, 24],
          [75, 24],
          [30, 42],
          [70, 42],
          [50, 10],
        ].map(([x, y], i) => (
          <span
            className="opponent-dot"
            style={{ left: x + "%", top: y + "%" }}
            key={i}
            aria-hidden="true"
          >
            ○
          </span>
        ))}
        {dots.map((p, i) => (
          <button
            key={p.player_id}
            className="tactical-dot"
            style={{ left: p.x + "%", top: p.y + "%" }}
            disabled={!editable || busy}
            aria-label={name(p.player_id)}
            onPointerDown={(e) => {
              if (!editable) return;
              drag.current = p.player_id;
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (drag.current !== p.player_id || !field.current) return;
              const r = field.current.getBoundingClientRect();
              move(
                p.player_id,
                ((e.clientX - r.left) / r.width) * 100,
                ((e.clientY - r.top) / r.height) * 100,
              );
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onKeyDown={(e) => {
              const delta: Record<string, [number, number]> = {
                ArrowUp: [0, -3],
                ArrowDown: [0, 3],
                ArrowLeft: [-3, 0],
                ArrowRight: [3, 0],
              };
              if (delta[e.key] && editable) {
                e.preventDefault();
                move(p.player_id, p.x + delta[e.key][0], p.y + delta[e.key][1]);
              }
            }}
          >
            <b>{i + 1}</b>
            <small>{name(p.player_id)}</small>
          </button>
        ))}
      </div>
      <p className="ballers-muted mt-2">
        {editable
          ? t(
              "Перетаскивай фигурки пальцем или мышью. На клавиатуре — стрелками.",
            )
          : t("Сохранённая расстановка ответственного.")}
      </p>
      {editable && (
        <>
          <label className="block mt-4">
            {t("Добавить игрока на поле")}
            <select
              className="network-input"
              value=""
              disabled={dots.length >= 5 || busy}
              onChange={(e) => {
                if (!e.target.value || dots.length >= 5) return;
                const [x, y] = preset[dots.length];
                setDots([...dots, { player_id: e.target.value, x, y }]);
              }}
            >
              <option value="">{t("Выбери игрока")}</option>
              {members
                .filter((p) => !dots.some((d) => d.player_id === p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {name(p.id)}
                  </option>
                ))}
            </select>
          </label>
          <div className="network-actions">
            {dots.map((p) => (
              <button
                disabled={busy}
                className="network-secondary"
                key={p.player_id}
                onClick={() =>
                  setDots(dots.filter((d) => d.player_id !== p.player_id))
                }
              >
                {name(p.player_id)} ×
              </button>
            ))}
          </div>
          <button
            className="neon-button green mt-4"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? t("Сохраняем…") : t("Сохранить расстановку")}
          </button>
          <button
            className="text-link ml-4"
            disabled={busy}
            onClick={() => {
              setDots(initial.layout);
              setNotice("");
              void reload();
            }}
          >
            {t("Загрузить сохранённую")}
          </button>
        </>
      )}
      {notice && (
        <p role="alert" className="error-panel mt-3">
          {notice}
        </p>
      )}
    </>
  );
}
