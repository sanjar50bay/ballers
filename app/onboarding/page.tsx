"use client";
import { uiError, t as tx } from "@/lib/i18n";

import { useLocale } from "@/app/components/Language";

import ProfilePhotoPicker from "@/app/components/ProfilePhotoPicker";
import {
  resolveProfilePhoto,
  photoError,
  type PhotoChoice,
} from "@/lib/profile-photo";
import Link from "next/link";
import { CitySelect } from "@/app/components/Network";
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
  useLocale();

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
  const [photo, setPhoto] = useState<PhotoChoice>({ kind: "keep" });
  const [photoBusy, setPhotoBusy] = useState(false);
  const [providerAvatar, setProviderAvatar] = useState<string | null>(null);
  const checkedUser = useRef<string | null>(null);
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
      checkedUser.current = user.id;
      setProviderAvatar(
        user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null,
      );
      const profile = await ownRegistrationProfile(supabase, user.id);
      if (seq !== generation.current) return;
      if (profile) {
        // Existing users never see the automatic first-profile card.
        window.location.replace("/");
        return;
      }
      setPhase("ready");
    } catch (e) {
      if (seq === generation.current) {
        setError(photoError(e) || registrationError(e));
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
    if (busy.current || phase !== "ready" || photoBusy) return;
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
      if (checkedUser.current !== user.id) throw new Error("PHOTO_ACCOUNT");
      const chosenAvatar =
        photo.kind === "keep"
          ? undefined
          : await resolveProfilePhoto(supabase, user.id, photo, providerAvatar);
      const savedProfile = await ensureRegistrationProfile(supabase, user, {
        ...input,
        ...(chosenAvatar !== undefined ? { avatar_url: chosenAvatar } : {}),
      });
      const current = await registrationUser(supabase);
      if (current?.id !== user.id) {
        setPhase("login");
        return;
      }
      // Only a confirmed fresh INSERT offers the card. A normal login never does.
      if (savedProfile.createdNow) {
        try {
          sessionStorage.setItem(
            "ballers:welcome:new-profile",
            savedProfile.id,
          );
        } catch {}
      }
      window.location.replace("/");
    } catch (e) {
      setError(photoError(e) || registrationError(e));
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
      <h1 className="text-3xl font-bold mt-5">{tx("Твой Baller ID")}</h1>
      <p className="ballers-muted mt-3 mb-6">
        {tx("Имя, город и позиция — и можно играть.")}
      </p>
      {phase === "checking" && (
        <p role="status" className="inline-loading">
          {tx("Проверяем профиль…")}
        </p>
      )}
      {phase === "login" && (
        <section className="error-panel">
          <p>
            {tx("Чтобы создать или открыть профиль, сначала войди в аккаунт.")}
          </p>
          <Link className="text-link block mt-4" href="/">
            {tx("Войти")}
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
          {uiError(error)}
        </p>
      )}
      {phase === "error" && (
        <button className="neon-button" onClick={() => void check()}>
          {tx("Повторить проверку")}
        </button>
      )}
      {(phase === "ready" || phase === "saving") && (
        <form onSubmit={saveProfile}>
          <fieldset disabled={phase === "saving"} className="space-y-4">
            <label className="block">
              {tx("Имя")}
              <input
                className={field}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                maxLength={100}
                autoComplete="given-name"
              />
            </label>
            <CitySelect value={city} onChange={setCity} id="onboarding-city" />
            <label className="block">
              {tx("Основная позиция")}
              <select
                className={field}
                value={primaryPosition}
                onChange={(e) => setPrimaryPosition(e.target.value)}
              >
                <option value="GK">{tx("Вратарь")}</option>
                <option value="DEF">{tx("Защитник")}</option>
                <option value="MID">{tx("Полузащитник")}</option>
                <option value="ATT">{tx("Нападающий")}</option>
              </select>
            </label>
            <ProfilePhotoPicker
              choice={photo}
              onChange={setPhoto}
              initialUrl={providerAvatar}
              name={[firstName, lastName].filter(Boolean).join(" ")}
              position={primaryPosition}
              onPreparing={setPhotoBusy}
              disabled={phase === "saving"}
            />
            <details className="profile-optional">
              <summary>{tx("Дополнить профиль")}</summary>
              <div className="space-y-4 mt-4">
                <label className="block">
                  {tx("Фамилия")}
                  <span className="ballers-muted">{tx("· необязательно")}</span>
                  <input
                    className={field}
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    maxLength={100}
                    autoComplete="family-name"
                  />
                </label>
                <label className="block">
                  {tx("Год рождения")}{" "}
                  <span className="ballers-muted">{tx("· необязательно")}</span>
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
                  {tx("Дополнительная позиция")}
                  <select
                    className={field}
                    value={secondaryPosition}
                    onChange={(e) => setSecondaryPosition(e.target.value)}
                  >
                    <option value="">{tx("Нет")}</option>
                    <option value="GK">{tx("Вратарь")}</option>
                    <option value="DEF">{tx("Защитник")}</option>
                    <option value="MID">{tx("Полузащитник")}</option>
                    <option value="ATT">{tx("Нападающий")}</option>
                  </select>
                </label>
                <label className="block">
                  {tx("Ведущая нога")}
                  <select
                    className={field}
                    value={dominantFoot}
                    onChange={(e) => setDominantFoot(e.target.value)}
                  >
                    <option value="RIGHT">{tx("Правая")}</option>
                    <option value="LEFT">{tx("Левая")}</option>
                    <option value="BOTH">{tx("Обе")}</option>
                  </select>
                </label>
              </div>
            </details>
            <button
              className="neon-button w-full"
              type="submit"
              disabled={
                phase === "saving" ||
                photoBusy ||
                !firstName.trim() ||
                !city.trim()
              }
            >
              {phase === "saving"
                ? tx("Сохраняем и открываем профиль…")
                : tx("Создать профиль")}
            </button>
          </fieldset>
        </form>
      )}
    </main>
  );
}
