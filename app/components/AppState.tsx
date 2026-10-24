"use client";
import { t as tx } from "@/lib/i18n";

import { useLocale } from "@/app/components/Language";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
export type Profile = {
  id: string;
  baller_id: number;
  first_name: string;
  last_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  city: string | null;
  primary_position: string;
};
export type Stats = {
  matches: number;
  goals: number;
  assists: number;
  saves: number;
  test_matches: number;
  test_goals: number;
};
export type GameDay = {
  id: string;
  community_id: string;
  title: string;
  game_date: string;
  start_time: string | null;
  venue: string | null;
  format: number;
  team_count: number;
  capacity: number | null;
  status: string;
  attendance_status: string | null;
  going: number;
  match_count: number;
  live: boolean;
};
export type HomeData = {
  profile: Profile | null;
  stats: Stats;
  communities: {
    id: string;
    name: string;
    city: string | null;
    role: string;
  }[];
  games: GameDay[];
  history: GameDay[];
};
type State = {
  session: Session | null;
  data: HomeData | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
};
const StateContext = createContext<State>({
  session: null,
  data: null,
  loading: true,
  error: "",
  refresh: async () => {},
});
export const useApp = () => useContext(StateContext);
export default function AppState({ children }: { children: React.ReactNode }) {
  useLocale();

  const [session, setSession] = useState<Session | null>(null),
    [data, setData] = useState<HomeData | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const user = useRef<string | null>(null),
    revision = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++revision.current;
    try {
      const {
        data: { session: s },
        error: authError,
      } = await supabase.auth.getSession();
      if (seq !== revision.current) return;
      setSession(s);
      user.current = s?.user.id || null;
      if (authError) throw authError;
      if (!s) {
        setData(null);
        setError("");
        return;
      }
      const { data: d, error: e } = await supabase
        .rpc("ballers_home")
        .abortSignal(AbortSignal.timeout(15000));
      if (seq !== revision.current) return;
      if (e) throw e;
      setData(d as HomeData);
      setError("");
    } catch (e) {
      if (seq === revision.current)
        setError(
          e instanceof Error
            ? e.message
            : tx(
                "Не удалось загрузить данные. Проверь соединение и миграцию 004.",
              ),
        );
    } finally {
      if (seq === revision.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      const id = s?.user.id || null;
      if (id !== user.current) {
        revision.current++;
        setData(null);
        setLoading(true);
        user.current = id;
      }
      setSession(s);
      setTimeout(() => void refresh(), 0);
    });
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    window.addEventListener("ballers:data-changed", focus);
    const invalidate = () => {
      revision.current++;
    };
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      subscription.unsubscribe();
      window.removeEventListener("focus", focus);
      window.removeEventListener("ballers:data-changed", focus);
      invalidate();
    };
  }, [refresh]);
  return (
    <StateContext.Provider value={{ session, data, loading, error, refresh }}>
      {children}
    </StateContext.Provider>
  );
}
