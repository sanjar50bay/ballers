"use client";
import { useId } from "react";
const shape =
  "M170 7 C162 27 151 26 140 15 C125 10 116 16 100 29 C69 53 37 65 10 70 L10 390 Q10 418 36 430 L170 494 L304 430 Q330 418 330 390 L330 70 C303 65 271 53 240 29 C224 16 215 10 200 15 C189 26 178 27 170 7Z";
export default function PlayerCardFrame() {
  const id = useId().replaceAll(":", "");
  return (
    <svg
      className="ultimate-card-frame"
      viewBox="0 0 340 500"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={id + "-base"} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#30225c" />
          <stop offset=".48" stopColor="#15113e" />
          <stop offset="1" stopColor="#251044" />
        </linearGradient>
        <linearGradient id={id + "-shine"}>
          <stop stopColor="#fff" stopOpacity="0" />
          <stop offset=".5" stopColor="#f1ff78" stopOpacity=".5" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={id + "-clip"}>
          <path d={shape} />
        </clipPath>
      </defs>
      <path
        d={shape}
        fill={"url(#" + id + "-base)"}
        stroke="#e9ff25"
        strokeWidth="2.8"
      />
      <g clipPath={"url(#" + id + "-clip)"}>
        <path d="M-10 280 280 25 355 45 15 420Z" fill="#514285" opacity=".14" />
        <path d="M10 140 260 75 345 210 75 300Z" fill="#c92f7e" opacity=".06" />
        {Array.from({ length: 23 }, (_, i) => (
          <path
            key={i}
            d={`M ${-35 + i * 5} ${208 + i * 4} C ${65 + i * 3} ${125 + i * 4},${172 + i * 2} ${185 - i * 4},350 ${66 + i * 4}`}
            fill="none"
            stroke={
              i % 4 === 0 ? "#ff3f83" : i % 5 === 0 ? "#deed25" : "#6952c8"
            }
            opacity={i % 4 === 0 ? 0.7 : 0.45}
            strokeWidth={i % 3 === 0 ? 2 : 1}
          />
        ))}
        {Array.from({ length: 15 }, (_, i) => (
          <path
            key={i}
            d={`M -15 ${300 + i * 6} C 80 ${187 + i * 5},200 ${245 + i * 2},360 ${151 + i * 7}`}
            fill="none"
            stroke={i % 4 === 0 ? "#ff357c" : "#4a3c91"}
            opacity=".44"
            strokeWidth="1.3"
          />
        ))}
        <path
          d="m38 205 48-30-29 31 19-5-39 32 12-22-23 10Zm229-80 45-28-18 27 31-11-40 41 14-30-39 17Z"
          fill="#f8fc31"
          opacity=".7"
        />
        <path
          d="M5 303Q170 277 335 300L340 500H0Z"
          fill="#1d123e"
          opacity=".92"
        />
        <rect
          className="ultimate-card-foil"
          x="-120"
          y="0"
          width="200"
          height="500"
          fill={"url(#" + id + "-shine)"}
        />
      </g>
      <path
        d={shape}
        transform="translate(5 7) scale(.97 .974)"
        fill="none"
        stroke="#e9ff25"
        strokeOpacity=".6"
        strokeWidth="1.1"
      />
    </svg>
  );
}
