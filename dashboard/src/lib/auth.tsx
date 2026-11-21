"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, supabaseConfigured } from "./supabase";

interface AuthValue {
  ready: boolean;
  configured: boolean;
  session: Session | null;
}

const AuthContext = createContext<AuthValue>({ ready: false, configured: false, session: null });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const configured = supabaseConfigured();
  const [ready, setReady] = useState(!configured);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!configured) return;
    const supabase = getSupabase();
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [configured]);

  const value = useMemo(() => ({ ready, configured, session }), [ready, configured, session]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
