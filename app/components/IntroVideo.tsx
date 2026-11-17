"use client";
import { useRef, useState } from "react";
import { useLocale } from "./Language";
import { t, type Locale } from "@/lib/i18n";
function VideoPlayer({ locale }: { locale: Locale }) {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  return (
    <>
      {!started && (
        <button
          className="intro-cover"
          style={{ backgroundImage: `url(/media/intro-${locale}.jpg)` }}
          aria-label={t("Смотреть видео о BALLERS")}
          onClick={() => {
            setStarted(true);
            void video.current?.play().catch(() => {
              /* Native controls remain available to retry. */
            });
          }}
        >
          <span className="intro-play" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="m7 4 13 8-13 8Z" fill="currentColor" />
            </svg>
          </span>
          <span className="intro-duration" aria-hidden="true">
            0:48
          </span>
        </button>
      )}
      <video
        ref={video}
        hidden={!started}
        className="intro-video"
        controls
        playsInline
        preload="none"
        poster={`/media/intro-${locale}.jpg`}
        aria-label={t("Знакомство с BALLERS")}
      >
        <source src={`/media/ballers-intro-${locale}.mp4`} type="video/mp4" />
        {t("Не удалось воспроизвести видео.")}{" "}
        <a href={`/media/ballers-intro-${locale}.mp4`}>{t("Открыть видео")}</a>
      </video>
    </>
  );
}
export default function IntroVideo() {
  const locale = useLocale();
  return (
    <section className="video-section" aria-label={t("Знакомство с BALLERS")}>
      <p className="eyebrow">{t("ПОСМОТРИ ПЕРЕД ПЕРВОЙ ИГРОЙ")}</p>
      <h2>{t("Знакомство с BALLERS")}</h2>
      <p className="desc">
        {t("Короткое видео: от сбора игроков до своей футбольной истории.")}
      </p>
      <VideoPlayer key={locale} locale={locale} />
      <div className="video-note">
        <span>{t("Видео на русском")}</span>
        <b>{t("Звук — по нажатию")}</b>
      </div>
      <p className="video-context">
        {t(
          "В ролике показано подтверждение капитанами. Сейчас по умолчанию результат учитывается после завершения матча ведущим. Подтверждение капитанами — отдельный режим.",
        )}
      </p>
    </section>
  );
}
