import { useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

const SESSION_KEY = "gs_session_id";

function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  let sid = sessionStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid =
      (crypto.randomUUID?.() as string) ||
      `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

async function track(
  eventName: string,
  properties: Record<string, unknown> = {},
) {
  if (typeof window === "undefined") return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
    };
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }
    const body = JSON.stringify({
      event_name: eventName,
      properties,
      session_id: getSessionId(),
      url: window.location.href.slice(0, 500),
      referrer: document.referrer?.slice(0, 500) || null,
    });
    // Fire-and-forget; keepalive lets it survive page unload
    await fetch(`${SUPABASE_URL}/functions/v1/track-event`, {
      method: "POST",
      headers,
      body,
      keepalive: true,
    });
  } catch (e) {
    // never block UI on analytics failures
    if (import.meta.env.DEV) console.warn("analytics track failed", e);
  }
}

export function useAnalytics() {
  return useCallback(track, []);
}

export function useTrackOnMount(
  eventName: string,
  properties: Record<string, unknown> = {},
) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    track(eventName, properties);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventName]);
}

export const trackEvent = track;
