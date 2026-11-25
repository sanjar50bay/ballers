"use client";

import { useEffect, useRef, useState } from "react";
import type { Provider } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import { useLocale } from "./Language";

async function authRequest<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("AUTH_TIMEOUT")), 20000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export default function SignIn({ returnTo = "/" }: { returnTo?: string }) {
  useLocale();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const lock = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  // Only local application routes may be used as a post-login destination.
  const destination =
    returnTo === "/" ||
    /^\/join\/[a-zA-Z0-9_-]+$/.test(returnTo) ||
    /^\/open-games\?game=[a-f0-9-]{36}$/i.test(returnTo)
      ? returnTo
      : "/";
  function rememberGame() {
    if (!destination.startsWith("/open-games?game=")) return;
    try {
      localStorage.setItem("ballers:network-return", destination);
    } catch {}
  }
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(
      () => setCooldown((n) => Math.max(0, n - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [cooldown]);
  useEffect(() => {
    if (sent) codeInput.current?.focus();
  }, [sent]);

  async function sendCode() {
    if (lock.current || cooldown) return;
    rememberGame();
    lock.current = true;
    setBusy(true);
    setError("");
    // Also throttle uncertain requests; resending is always an explicit action.
    setCooldown(60);
    try {
      const { error } = await authRequest(
        supabase.auth.signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: window.location.origin + destination },
        }),
      );
      if (error) throw error;
      setCode("");
      setSent(true);
      codeInput.current?.focus();
    } catch {
      setError(
        t("Не удалось отправить код. Проверь адрес и попробуй ещё раз."),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function verifyCode() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const { data, error } = await authRequest(
        supabase.auth.verifyOtp({
          email: email.trim(),
          token: code.trim(),
          type: "email",
        }),
      );
      if (error || !data.session) throw error || new Error("NO_SESSION");
      // Reload also resumes the existing invite/profile registration flow.
      window.location.replace(destination);
    } catch {
      setError(t("Код не подошёл или истёк. Проверь его или запроси новый."));
      setBusy(false);
      lock.current = false;
    }
  }
  async function oauth(provider: Provider) {
    if (lock.current) return;
    rememberGame();
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const { error } = await authRequest(
        supabase.auth.signInWithOAuth({
          provider,
          options: { redirectTo: window.location.origin + destination },
        }),
      );
      if (error) throw error;
    } catch {
      setError(t("Не удалось открыть вход. Попробуй ещё раз."));
      setBusy(false);
      lock.current = false;
    }
  }
  return (
    <div className="signin-options">
      {process.env.NEXT_PUBLIC_AUTH_EMAIL_ENABLED === "true" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void (sent ? verifyCode() : sendCode());
          }}
        >
          <label className="network-field">
            <span>{t("Электронная почта")}</span>
            <input
              ref={emailInput}
              className="network-input"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              readOnly={sent}
              disabled={busy}
              required
              maxLength={254}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {!sent && (
            <p className="ballers-muted">{t("Любая почта. Без пароля.")}</p>
          )}
          {sent && (
            <>
              <p role="status" className="ballers-muted">
                {t("Код отправлен на {email}", { email: email.trim() })}
              </p>
              <label className="network-field">
                <span>{t("Код из письма")}</span>
                <input
                  ref={codeInput}
                  className="network-input signin-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6,10}"
                  minLength={6}
                  maxLength={10}
                  required
                  disabled={busy}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </label>
            </>
          )}
          <button
            className="neon-button green w-full"
            type="submit"
            disabled={busy || (!sent && cooldown > 0)}
          >
            {busy
              ? t("Подожди…")
              : sent
                ? t("Войти")
                : cooldown
                  ? t("Повторить через {seconds} с", { seconds: cooldown })
                  : t("Получить код")}
          </button>
          {sent && (
            <div className="signin-secondary">
              <button
                className="text-link"
                type="button"
                disabled={busy || cooldown > 0}
                onClick={() => void sendCode()}
              >
                {cooldown
                  ? t("Повторить через {seconds} с", { seconds: cooldown })
                  : t("Отправить код ещё раз")}
              </button>
              <button
                className="text-link"
                type="button"
                disabled={busy}
                onClick={() => {
                  setSent(false);
                  setCode("");
                  setError("");
                  setTimeout(() => emailInput.current?.focus(), 0);
                }}
              >
                {t("Изменить почту")}
              </button>
            </div>
          )}
        </form>
      )}
      <button
        className="provider-button"
        disabled={busy}
        onClick={() => void oauth("google")}
      >
        {t("Продолжить с Google")}
      </button>
      {process.env.NEXT_PUBLIC_AUTH_APPLE_ENABLED === "true" && (
        <button
          className="provider-button"
          disabled={busy}
          onClick={() => void oauth("apple")}
        >
          {t("Продолжить с Apple")}
        </button>
      )}
      {process.env.NEXT_PUBLIC_AUTH_VK_PROVIDER?.startsWith("custom:") && (
        <button
          className="provider-button"
          disabled={busy}
          onClick={() =>
            void oauth(process.env.NEXT_PUBLIC_AUTH_VK_PROVIDER as Provider)
          }
        >
          {t("Продолжить с VK")}
        </button>
      )}
      {error && (
        <p role="alert" className="error-panel">
          {error}
        </p>
      )}
    </div>
  );
}
