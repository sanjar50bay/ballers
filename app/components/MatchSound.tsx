"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { t } from "@/lib/i18n";
import { useLocale } from "./Language";
import Icon from "./Icon";
type M = { id: string; status: string };
type E = {
  id: string;
  kind: string;
  voided: boolean;
  assist_id: string | null;
};
type Controls = {
  enabled: boolean;
  volume: number;
  warming: boolean;
  error: string;
  toggle: () => void;
  setVolume: (value: number) => void;
};
const AudioSettings = createContext<Controls | null>(null);
export default function MatchSound({
  gameId,
  matches,
  events,
  ready,
  children,
}: {
  gameId: string;
  matches: M[];
  events: E[];
  ready: boolean;
  children: ReactNode;
}) {
  const [enabled, setEnabled] = useState(false),
    [volume, setVolume] = useState(50),
    [warming, setWarming] = useState(false),
    [error, setError] = useState("");
  const context = useRef<AudioContext | null>(null),
    master = useRef<GainNode | null>(null),
    lock = useRef(false),
    last = useRef<{
      game: string;
      matches: Map<string, string>;
      events: Set<string>;
    } | null>(null);
  function tone(frequency: number, at: number, length: number, gain = 0.12) {
    const ctx = context.current;
    if (!ctx || ctx.state !== "running" || !master.current) return;
    const osc = ctx.createOscillator(),
      node = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    node.gain.setValueAtTime(0, ctx.currentTime + at);
    node.gain.linearRampToValueAtTime(gain, ctx.currentTime + at + 0.015);
    node.gain.exponentialRampToValueAtTime(
      0.001,
      ctx.currentTime + at + length,
    );
    osc.connect(node);
    node.connect(master.current);
    osc.start(ctx.currentTime + at);
    osc.stop(ctx.currentTime + at + length);
  }
  useEffect(() => {
    if (master.current && context.current)
      master.current.gain.setValueAtTime(
        enabled ? volume / 100 : 0,
        context.current.currentTime,
      );
  }, [enabled, volume]);
  useEffect(() => {
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
      !ready ||
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
    if (started || ended) {
      tone(2450, 0, 0.22);
      tone(2650, 0.26, ended ? 0.6 : 0.2);
    }
    const fresh = events.filter((e) => !old.events.has(e.id) && !e.voided);
    if (!started && !ended && fresh.length) {
      const event = fresh.at(-1)!;
      if (event.kind === "GOAL") {
        tone(660, 0, 0.18);
        tone(880, 0.18, 0.2);
        tone(1100, 0.4, 0.3);
        if (event.assist_id) tone(1320, 0.75, 0.15);
      } else if (event.kind === "SAVE") {
        tone(520, 0, 0.18);
        tone(780, 0.2, 0.2);
      } else if (event.kind === "YELLOW") tone(440, 0, 0.35);
      else if (event.kind === "RED") {
        tone(240, 0, 0.3);
        tone(180, 0.35, 0.35);
      } else tone(300, 0, 0.4);
    }
    // Snapshot IDs deduplicate polling; the master node applies current volume immediately.
  }, [matches, events, gameId, ready, enabled]);
  useEffect(
    () => () => {
      void context.current?.close();
    },
    [],
  );
  async function toggle() {
    if (lock.current) return;
    if (enabled) {
      if (master.current) master.current.gain.value = 0;
      setEnabled(false);
      return;
    }
    lock.current = true;
    setWarming(true);
    try {
      if (!context.current) {
        context.current = new AudioContext();
        master.current = context.current.createGain();
        master.current.gain.value = 0;
        master.current.connect(context.current.destination);
      }
      await context.current.resume();
      master.current!.gain.value = volume / 100;
      setEnabled(true);
      setError("");
      tone(880, 0, 0.12, 0.04);
    } catch {
      setError("Браузер не разрешил звук. Нажми ещё раз.");
    } finally {
      lock.current = false;
      setWarming(false);
    }
  }
  return (
    <AudioSettings.Provider
      value={{
        enabled,
        volume,
        warming,
        error,
        toggle: () => void toggle(),
        setVolume,
      }}
    >
      {children}
    </AudioSettings.Provider>
  );
}
export function MatchSoundControl() {
  useLocale();
  const settings = useContext(AudioSettings);
  if (!settings) return null;
  const { enabled, volume, warming, error, toggle, setVolume } = settings;
  return (
    <details
      className="match-audio-control"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label={t("Настроить звук матча")}>
        <Icon name={enabled && volume > 0 ? "volume" : "volume-off"} />
        <span className="sr-only">
          {t(enabled ? "Звук включён" : "Звук выключен")}
        </span>
      </summary>
      <div className="match-audio-popover">
        <button
          type="button"
          aria-pressed={enabled}
          disabled={warming}
          onClick={toggle}
        >
          {t(
            warming ? "Подожди…" : enabled ? "Выключить звук" : "Включить звук",
          )}
        </button>
        <label>
          {t("Громкость")}: {volume}%
          <input
            aria-label={t("Громкость матча")}
            type="range"
            min="0"
            max="100"
            step="5"
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
          />
        </label>
        <small>{t("Звуки событий и свисток, пока открыт экран матча.")}</small>
        {error && <p role="alert">{t(error)}</p>}
      </div>
    </details>
  );
}
