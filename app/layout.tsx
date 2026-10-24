import type { Metadata } from "next";
import LanguageBar from "./components/Language";
import AppState from "./components/AppState";
import Notifications from "./components/Notifications";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BALLERS — твой футбол",
  description:
    "Любительский футбол: игры, команды и подтверждённая история игрока",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <LanguageBar />
        <AppState>
          <Notifications>{children}</Notifications>
        </AppState>
      </body>
    </html>
  );
}
