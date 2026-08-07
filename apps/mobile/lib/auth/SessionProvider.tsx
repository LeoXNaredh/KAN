import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { UserIdentity } from "@kan/core";
import { supabase } from "../supabase/client";
import { buildAuthUseCases, type AuthUseCases } from "./composition";

interface SessionContextValue {
  session: UserIdentity | undefined;
  isLoading: boolean;
  useCases: AuthUseCases;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

/**
 * Estado de sesión vivo (docs/18, incremento 2) — mismo rol que
 * `getCurrentUserCached()` en `apps/web`, pero además se suscribe a
 * `supabase.auth.onAuthStateChange(...)` para reaccionar a login/logout/
 * refresh sin recargar la app (en web esto no hace falta: cada navegación
 * es un request nuevo al servidor, que vuelve a leer las cookies).
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const useCases = useMemo(() => buildAuthUseCases(), []);
  const [session, setSession] = useState<UserIdentity | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    useCases.getCurrentUser.execute().then((user) => {
      setSession(user);
      setIsLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, authSession) => {
      setSession(
        authSession?.user ? { userId: authSession.user.id, email: authSession.user.email ?? "" } : undefined,
      );
    });

    return () => listener.subscription.unsubscribe();
  }, [useCases]);

  return <SessionContext.Provider value={{ session, isLoading, useCases }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession() debe usarse dentro de <SessionProvider>.");
  return context;
}
