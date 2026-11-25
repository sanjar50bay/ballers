"use client";
import SignIn from "./SignIn";
import { t, uiError } from "@/lib/i18n";
import { useLocale } from "./Language";
import IntroVideo from "./IntroVideo";
import PublicGamesPreview from "./PublicGamesPreview";
export default function LandingPage({ error }: { error: string }) {
  useLocale();
  return (
    <main className="landing-page">
      <div className="wrap">
        <header>
          <div className="logo">
            BALLERS<span>.</span>
          </div>
          <div className="beta">{t("ФУТБОЛ ТВОЕГО ГОРОДА")}</div>
        </header>
        <section className="hero">
          <p className="eyebrow">
            {t("ТВОЯ КОМАНДА. ТВОЯ ИГРА. ТВОЯ ИСТОРИЯ.")}
          </p>
          <h1>
            {t("Твой футбол.")}
            <br />
            <span>{t("Твоя история.")}</span>
          </h1>
          <p className="intro">
            {t(
              "Найди свою команду или присоединяйся к играм. Уже есть команда? Собери её в BALLERS и организуй свою игру.",
            )}
          </p>
          <PublicGamesPreview />
          <div id="signin" className="landing-signin">
            <SignIn />
            <p className="return">
              {t("Уже играл?")} <strong>{t("Войди тем же аккаунтом.")}</strong>
            </p>
            {error && (
              <p role="alert" className="error-panel">
                {uiError(error)}
              </p>
            )}
          </div>
          <div className="visual">
            <div className="pitch" aria-hidden="true" />
            <span className="tag">{t("ОДИН ПРОФИЛЬ · ВСЯ ТВОЯ ИСТОРИЯ")}</span>
            <h2>{t("Не обязательно иметь команду. Достаточно желания.")}</h2>
            <div className="orb" aria-hidden="true">
              <svg
                viewBox="0 0 100 100"
                fill="none"
                stroke="#79ffb7"
                strokeWidth="3"
              >
                <circle cx="50" cy="50" r="42" />
                <path d="m50 28 21 15-8 25H37l-8-25Z M50 28V8 M71 43l19-6 M63 68l13 17 M37 68 24 85 M29 43 10 37" />
              </svg>
            </div>
            <div className="avatar" aria-hidden="true">
              A
            </div>
            <div className="avatar two" aria-hidden="true">
              S
            </div>
            <p>{t("Открытые игры и новые знакомства.")}</p>
            <span className="mini">{t("Играй вместе")}</span>
          </div>
        </section>
        <details className="landing-more">
          <summary>{t("Как это работает")}</summary>
          <section className="section">
            <h2>{t("До первой игры — три простых шага")}</h2>
            <div className="steps">
              {[
                [
                  "Войди по почте или через Google",
                  "Один аккаунт — один Baller ID.",
                ],
                [
                  "Создай профиль игрока",
                  "Укажи имя, город и игровую позицию.",
                ],
                ["Найди свою игру", "Выбери игровой день и подай заявку."],
              ].map(([title, description], index) => (
                <div className="step" key={title}>
                  <span className="num">{index + 1}</span>
                  <div>
                    <b>{t(title)}</b>
                    <p>{t(description)}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="hint">
              <b>{t("Хочешь собрать свою компанию?")}</b>
              <p>
                {t(
                  "После входа можно создать команду, сообщество или игровой день.",
                )}
              </p>
            </div>
          </section>
        </details>
        <IntroVideo />
        <section className="last">
          <h2>{t("Увидимся на поле?")}</h2>
          <p>{t("Твой следующий футбол может начаться с одного входа.")}</p>
          <a
            className="google"
            href="#signin"
            onClick={(event) => {
              event.preventDefault();
              const form = document.getElementById("signin");
              form?.scrollIntoView({ block: "start" });
              form
                ?.querySelector<HTMLElement>("input, button")
                ?.focus({ preventScroll: true });
            }}
          >
            {t("Войти")}
          </a>
        </section>
        <footer>
          <span>BALLERS.</span>
          <span>{t("Твой футбол. Твоя история.")}</span>
        </footer>
      </div>
    </main>
  );
}
