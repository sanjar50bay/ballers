"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  ensureRegistrationProfile,
  ownRegistrationProfile,
  registrationError,
  registrationUser,
  registrationValidation,
} from "@/lib/profile-registration";

export default function OnboardingPage() {
  const [firstName, setFirstName] = useState(""),
    [lastName, setLastName] = useState(""),
    [city, setCity] = useState("Astana"),
    [birthYear, setBirthYear] = useState(""),
    [primaryPosition, setPrimaryPosition] = useState("MID"),
    [secondaryPosition, setSecondaryPosition] = useState(""),
    [dominantFoot, setDominantFoot] = useState("RIGHT"),
    [phase, setPhase] = useState<
      "checking" | "ready" | "saving" | "login" | "error"
    >("checking"),
    [error, setError] = useState("");
  const busy = useRef(false),
    generation = useRef(0),
    errorRef = useRef<HTMLParagraphElement>(null);
  const check = useCallback(async () => {
    const seq = ++generation.current;
    setPhase("checking");
    setError("");
    try {
      const user = await registrationUser(supabase);
      if (seq !== generation.current) return;
      if (!user) {
        setPhase("login");
        return;
      }
      const profile = await ownRegistrationProfile(supabase, user.id);
      if (seq !== generation.current) return;
      if (profile) {
        // Fresh document resets AppState, including a cached `profile: null`.
        window.location.replace("/");
        return;
      }
      setPhase("ready");
    } catch (e) {
      if (seq === generation.current) {
        setError(registrationError(e));
        setPhase("error");
      }
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void check(), 0);
    const invalidate = () => {
      generation.current++;
    };
    return () => {
      clearTimeout(timer);
      invalidate();
    };
  }, [check]);

  useEffect(() => {
    if (error) {
      errorRef.current?.scrollIntoView({ block: "center" });
      errorRef.current?.focus({ preventScroll: true });
    }
  }, [error]);

  async function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy.current || phase !== "ready") return;
    const input = {
      first_name: firstName,
      last_name: lastName,
      city,
      birth_year: birthYear ? Number(birthYear) : null,
      primary_position: primaryPosition,
      secondary_position: secondaryPosition || null,
      dominant_foot: dominantFoot,
    };
    const invalid = registrationValidation(input);
    if (invalid) {
      setError(invalid);
      return;
    }
    busy.current = true;
    setPhase("saving");
    setError("");
    try {
      const user = await registrationUser(supabase);
      if (!user) {
        setPhase("login");
        return;
      }
      await ensureRegistrationProfile(supabase, user, input);
      const current = await registrationUser(supabase);
      if (current?.id !== user.id) {
        setPhase("login");
        return;
      }
      window.location.replace("/");
    } catch (e) {
      setError(registrationError(e));
      setPhase("ready");
    } finally {
      busy.current = false;
    }
  }
  const field =
    "block w-full rounded-xl px-4 py-3 mt-2 bg-[#111725] border border-[#39465d]";
  return (
    <main className="ballers-shell pb-10">
      <header className="flex items-center h-[72px]">
        <Link href="/" className="text-2xl font-black">
          BALLERS<span className="text-[#79ffb0]">.</span>
        </Link>
      </header>
      <h1 className="text-3xl font-bold mt-5">Твой Baller ID</h1>
      <p className="ballers-muted mt-3 mb-6">
        Расскажи немного о себе. Один профиль — для всех твоих команд и игр.
      </p>
      {phase === "checking" && (
        <p role="status" className="inline-loading">
          Проверяем профиль…
        </p>
      )}
      {phase === "login" && (
        <section className="error-panel">
          <p>Чтобы создать или открыть профиль, сначала войди в аккаунт.</p>
          <Link className="text-link block mt-4" href="/">
            Войти через Google
          </Link>
        </section>
      )}
      {error && (
        <p
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="error-panel mb-4"
        >
          {error}
        </p>
      )}
      {phase === "error" && (
        <button className="neon-button" onClick={() => void check()}>
          Повторить проверку
        </button>
      )}
      {(phase === "ready" || phase === "saving") && (
        <form onSubmit={saveProfile}>
          <fieldset disabled={phase === "saving"} className="space-y-4">
            <label className="block">
              Имя
              <input
                className={field}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                maxLength={100}
                autoComplete="given-name"
              />
            </label>
            <label className="block">
              Фамилия <span className="ballers-muted">· необязательно</span>
              <input
                className={field}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                maxLength={100}
                autoComplete="family-name"
              />
            </label>
            <label className="block">
              Город
              <input
                className={field}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                required
                maxLength={100}
                autoComplete="address-level2"
              />
            </label>
            <label className="block">
              Год рождения{" "}
              <span className="ballers-muted">· необязательно</span>
              <input
                className={field}
                type="number"
                min={1900}
                max={new Date().getFullYear()}
                step={1}
                inputMode="numeric"
                value={birthYear}
                onChange={(e) => setBirthYear(e.target.value)}
              />
            </label>
            <label className="block">
              Основная позиция
              <select
                className={field}
                value={primaryPosition}
                onChange={(e) => setPrimaryPosition(e.target.value)}
              >
                <option value="GK">Вратарь</option>
                <option value="DEF">Защитник</option>
                <option value="MID">Полузащитник</option>
                <option value="ATT">Нападающий</option>
              </select>
            </label>
            <label className="block">
              Дополнительная позиция
              <select
                className={field}
                value={secondaryPosition}
                onChange={(e) => setSecondaryPosition(e.target.value)}
              >
                <option value="">Нет</option>
                <option value="GK">Вратарь</option>
                <option value="DEF">Защитник</option>
                <option value="MID">Полузащитник</option>
                <option value="ATT">Нападающий</option>
              </select>
            </label>
            <label className="block">
              Ведущая нога
              <select
                className={field}
                value={dominantFoot}
                onChange={(e) => setDominantFoot(e.target.value)}
              >
                <option value="RIGHT">Правая</option>
                <option value="LEFT">Левая</option>
                <option value="BOTH">Обе</option>
              </select>
            </label>
            <button
              className="neon-button w-full"
              type="submit"
              disabled={phase === "saving" || !firstName.trim() || !city.trim()}
            >
              {phase === "saving"
                ? "Сохраняем и открываем профиль…"
                : "Создать профиль"}
            </button>
          </fieldset>
          <p className="ballers-muted mt-4">
            Если соединение прервётся, повторная отправка сначала проверит
            сохранённый профиль.
          </p>
        </form>
      )}
    </main>
  );
}
