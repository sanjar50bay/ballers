"use client";
import { uiError, t as tx } from "@/lib/i18n";

import { useLocale } from "@/app/components/Language";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
type C = {
  id: string;
  name: string;
  city: string | null;
  default_format: number;
  default_team_count: number;
  default_capacity: number | null;
  team_mode: string;
};
export default function CommunityMenu({
  community: c,
  canManage,
  onSaved,
  inviteOnly = false,
}: {
  community: C;
  canManage: boolean;
  onSaved?: () => void;
  inviteOnly?: boolean;
}) {
  useLocale();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [link, setLink] = useState("");
  const [name, setName] = useState(c.name),
    [city, setCity] = useState(c.city || ""),
    [format, setFormat] = useState(c.default_format),
    [teams, setTeams] = useState(c.default_team_count),
    [capacity, setCapacity] = useState(c.default_capacity || 15),
    [mode, setMode] = useState(c.team_mode);
  async function action(type: string) {
    setBusy(true);
    setMessage("");
    const { data, error } = await supabase.rpc("ballers_community_action", {
      p_community: c.id,
      p_action: type,
      p_payload:
        type === "UPDATE" ? { name, city, format, teams, capacity, mode } : {},
    });
    setBusy(false);
    if (error) {
      setMessage(
        error.message.includes("PGRST202")
          ? tx("Нужна миграция 003.")
          : error.message,
      );
      return;
    }
    if (type === "INVITE") {
      setLink(`${location.origin}/join/${data.token}`);
      setMessage(tx("Ссылка действует 7 дней, до 50 новых участников."));
    } else {
      setMessage(tx("Сохранено. Уже созданные игры не изменены."));
      onSaved?.();
    }
  }
  return (
    <>
      <button
        aria-label={
          inviteOnly
            ? tx("Пригласить игроков в сообщество")
            : tx("Меню сообщества")
        }
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={
          inviteOnly
            ? "w-full h-full min-h-32 rounded-[20px] border border-emerald-800/40 bg-[#071b15] p-4 text-left hover:border-emerald-500 focus-visible:outline-2 focus-visible:outline-violet-400"
            : "w-11 h-11 rounded-full border border-violet-900/50 bg-[#090b14] text-gray-300 focus-visible:outline-2 focus-visible:outline-violet-400"
        }
      >
        {inviteOnly ? (
          <>
            <span className="text-2xl">👥</span>
            <p className="font-bold mt-3">{tx("Invite Players")}</p>
            <p className="text-sm text-gray-400 mt-1">
              {tx("Пригласить в сообщество по ссылке")}
            </p>
          </>
        ) : (
          "•••"
        )}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/80 overflow-y-auto p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <section
            role="dialog"
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Tab") {
                const targets = Array.from(
                  e.currentTarget.querySelectorAll<HTMLElement>(
                    "a[href],button:not([disabled]),input,select",
                  ),
                );
                const first = targets[0],
                  last = targets.at(-1);
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }
            }}
            aria-modal="true"
            aria-label={
              inviteOnly
                ? tx("Приглашение в сообщество")
                : tx("Меню сообщества")
            }
            className="max-w-md mx-auto my-8 rounded-xl border border-white/20 bg-[#0d1120] p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">
                {inviteOnly ? tx("Пригласить игроков") : tx("Сообщество")}
              </h2>
              <button
                autoFocus
                aria-label={tx("Закрыть меню")}
                className="w-11 h-11"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            {message && (
              <p role="status" className="text-violet-200 break-words">
                {uiError(message)}
              </p>
            )}
            {!inviteOnly && (
              <>
                <Link
                  className="block min-h-11 py-3 text-violet-300"
                  href={`/communities/${c.id}/games`}
                >
                  {tx("Все игровые дни →")}
                </Link>
                <Link
                  className="block min-h-11 py-3 text-violet-300"
                  href="/communities"
                >
                  {tx("Мои сообщества →")}
                </Link>
              </>
            )}
            {canManage ? (
              <>
                {!inviteOnly && (
                  <form
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void action("UPDATE");
                    }}
                  >
                    <h3 className="font-bold">
                      {tx("Настройки по умолчанию")}
                    </h3>
                    <p className="text-sm text-gray-400">
                      {tx(
                        "Применяются к новым игровым дням. Текущие матчи не меняются.",
                      )}
                    </p>
                    {[
                      ["Название", name, setName],
                      ["Город", city, setCity],
                    ].map(([label, value, setter]) => (
                      <label className="block" key={tx(label as string)}>
                        {tx(label as string)}
                        <input
                          required={label === "Название"}
                          maxLength={80}
                          value={value as string}
                          onChange={(e) =>
                            (setter as (v: string) => void)(e.target.value)
                          }
                          className="block w-full bg-[#191d2b] border border-white/20 rounded-lg p-3 mt-1"
                        />
                      </label>
                    ))}
                    {[
                      ["Игроков на поле", format, setFormat, 1, 11],
                      ["Команд", teams, setTeams, 2, 8],
                      ["Мест", capacity, setCapacity, 1, 200],
                    ].map(([label, value, setter, min, max]) => (
                      <label className="block" key={tx(label as string)}>
                        {tx(label as string)}
                        <input
                          type="number"
                          required
                          min={min as number}
                          max={max as number}
                          value={value as number}
                          onChange={(e) =>
                            (setter as (v: number) => void)(
                              Number(e.target.value),
                            )
                          }
                          className="block w-full bg-[#191d2b] border border-white/20 rounded-lg p-3 mt-1"
                        />
                      </label>
                    ))}
                    <label className="block">
                      {tx("Режим")}
                      <select
                        value={mode}
                        onChange={(e) => setMode(e.target.value)}
                        className="block w-full bg-[#191d2b] border border-white/20 rounded-lg p-3 mt-1"
                      >
                        <option value="RANDOM">{tx("Random")}</option>
                        <option value="FIXED">{tx("Fixed")}</option>
                        <option value="MIXED">{tx("Mixed")}</option>
                      </select>
                    </label>
                    <button
                      disabled={busy}
                      className="w-full rounded-lg bg-violet-600 min-h-11 p-3 disabled:opacity-50"
                    >
                      {tx("Сохранить настройки")}
                    </button>
                  </form>
                )}
                <button
                  disabled={busy}
                  onClick={() => void action("INVITE")}
                  className="w-full min-h-11 p-3 rounded-lg border border-emerald-600 disabled:opacity-50"
                >
                  {tx("Создать ссылку приглашения")}
                </button>
                {link && (
                  <>
                    <label className="block">
                      {tx("Ссылка")}
                      <input
                        readOnly
                        value={link}
                        onFocus={(e) => e.target.select()}
                        className="w-full mt-1 p-3 rounded-lg bg-[#191d2b] border border-white/20"
                      />
                    </label>
                    <button
                      className="w-full min-h-11 p-3 border border-white/20 rounded-lg"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(link);
                          setMessage(tx("Ссылка скопирована."));
                        } catch {
                          setMessage(tx("Выдели ссылку и скопируй вручную."));
                        }
                      }}
                    >
                      {tx("Скопировать ссылку")}
                    </button>
                    <p className="text-sm text-gray-400">
                      {tx(
                        "Человек войдёт через Google и станет участником сообщества. В игру автоматически не записывается. Для другого устройства localhost нужно заменить доступным адресом приложения.",
                      )}
                    </p>
                  </>
                )}
              </>
            ) : (
              <p>
                {tx(
                  "Настройки и приглашения доступны менеджеру. Остальные разделы можно открыть выше.",
                )}
              </p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
