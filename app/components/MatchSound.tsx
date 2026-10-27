"use client";
import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { useLocale } from "./Language";
type M = { id: string; status: string };
type E = {
  id: string;
  match_id: string;
  kind: string;
  voided: boolean;
  assist_id: string | null;
};
export default function MatchSound({
  gameId,
  matches,
  events,
  ready,
}: {
  gameId: string;
  matches: M[];
  events: E[];
  ready: boolean;
}) {
  useLocale();
  const [enabled, setEnabled] = useState(false),
    [error, setError] = useState("");
  const context = useRef<AudioContext | null>(null),
    last = useRef<{
      game: string;
      matches: Map<string, string>;
      events: Set<string>;
    } | null>(null);
  function tone(f: number, at: number, len: number, vol = 0.12) {
    const c = context.current;
    if (!c || c.state !== "running") return;
    const osc = c.createOscillator(),
      gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0, c.currentTime + at);
    gain.gain.linearRampToValueAtTime(vol, c.currentTime + at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + at + len);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(c.currentTime + at);
    osc.stop(c.currentTime + at + len);
  }
  function whistle(end = false) {
    tone(2450, 0, 0.22);
    tone(2650, 0.26, end ? 0.6 : 0.2);
  }
  useEffect(() => {
    if (!ready) return;
    const current = {
      game: gameId,
      matches: new Map(matches.map((m) => [m.id, m.status])),
      events: new Set(events.map((e) => e.id)),
    };
    const old = last.current;
    last.current = current;
    if (
      !old ||
      old.game !== gameId ||
      !enabled ||
      document.visibilityState !== "visible"
    )
      return;
    const started = matches.some(
      (m) => !old.matches.has(m.id) && m.status === "LIVE",
    );
    const ended = matches.some(
      (m) =>
        ["LIVE", "PAUSED"].includes(old.matches.get(m.id) || "") &&
        !["LIVE", "PAUSED"].includes(m.status),
    );
    if (started || ended) whistle(ended);
    const fresh = events.filter((e) => !old.events.has(e.id) && !e.voided);
    if (!started && !ended && fresh.length) {
      const e = fresh.at(-1)!;
      if (e.kind === "GOAL") {
        tone(660, 0, 0.18);
        tone(880, 0.18, 0.2);
        tone(1100, 0.4, 0.3);
        if (e.assist_id) tone(1320, 0.75, 0.15);
      } else if (e.kind === "SAVE") {
        tone(520, 0, 0.18);
        tone(780, 0.2, 0.2);
      } else if (e.kind === "YELLOW") {
        tone(440, 0, 0.35);
      } else if (e.kind === "RED") {
        tone(240, 0, 0.3);
        tone(180, 0.35, 0.35);
      } else {
        tone(300, 0, 0.4);
      }
    }
    // Functions use the current audio context; last snapshot deduplicates polling and initial loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, events, gameId, ready, enabled]);
  useEffect(
    () => () => {
      void context.current?.close();
    },
    [],
  );
  async function toggle() {
    if (enabled) {
      setEnabled(false);
      return;
    }
    try {
      context.current ??= new AudioContext();
      await context.current.resume();
      setEnabled(true);
      setError("");
      tone(880, 0, 0.12, 0.04);
    } catch {
      setError(t("Браузер не разрешил звук. Нажми ещё раз."));
    }
  }
  return (
    <div className="match-sound my-3">
      <button
        className="network-secondary"
        aria-pressed={enabled}
        onClick={() => void toggle()}
      >
        {enabled ? t("Звук включён") : t("Включить звук матча")}
      </button>
      <small className="ballers-muted">
        {t(
          "Звук работает на открытом экране после включения. Не является push-уведомлением.",
        )}
      </small>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
