"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/app/components/AppState";
import { networkRpc, networkError } from "./network";
export function useNetworkResource<T>(
  name: string,
  args: Record<string, unknown> = {},
  enabled = true,
) {
  const [result, setResult] = useState<{ key: string; value: T | null }>({
      key: "",
      value: null,
    }),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const seq = useRef(0);
  const key = JSON.stringify(args);
  const { session } = useApp();
  const identity = name + key + (session?.user.id || "anonymous");
  const [errorKey, setErrorKey] = useState("");
  const reload = useCallback(async () => {
    if (!enabled) {
      setResult({ key: identity, value: null });
      return;
    }
    const n = ++seq.current;
    setLoading(true);
    setError("");
    try {
      const d = await networkRpc<T>(name, JSON.parse(key));
      if (n === seq.current) setResult({ key: identity, value: d });
    } catch (e) {
      if (n === seq.current) {
        setError(networkError(e));
        setErrorKey(identity);
      }
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [name, key, enabled, identity]);
  useEffect(() => {
    const tm = setTimeout(() => void reload(), 180);
    return () => {
      clearTimeout(tm);
      // A numeric request generation, not a DOM ref: invalidate in-flight results.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      seq.current++;
    };
  }, [reload]);
  useEffect(() => {
    const cb = () => void reload();
    window.addEventListener("ballers:network-changed", cb);
    return () => window.removeEventListener("ballers:network-changed", cb);
  }, [reload]);
  return {
    data: enabled && result.key === identity ? result.value : null,
    loading,
    error: errorKey === identity ? error : "",
    reload,
  };
}

// Keep an uncertain action's ID for a deliberate retry; success starts a fresh operation.
export function useTeamAction() {
  const { session } = useApp();
  const pending = useRef(new Map<string, string>());
  return async (args: Record<string, unknown>) => {
    const key = JSON.stringify([session?.user.id, args]);
    const id = pending.current.get(key) || crypto.randomUUID();
    pending.current.set(key, id);
    const result = await networkRpc("ballers_club_action", {
      ...args,
      p_operation: id,
    });
    pending.current.delete(key);
    return result;
  };
}
