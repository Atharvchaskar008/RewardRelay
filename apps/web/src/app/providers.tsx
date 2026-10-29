"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { onIdTokenChanged, type User } from "firebase/auth";
import { SakerProvider } from "@/client/sdk";
import { appConfig } from "@/client/config";
import { firebaseAuth } from "@/client/firebase";

/** Firebase session state for the UI (the SDK gets ID tokens through `getIdToken`). */
interface Session {
  ready: boolean;
  user: User | null;
}

const SessionContext = createContext<Session>({ ready: false, user: null });

export function useSession(): Session {
  return useContext(SessionContext);
}

export function Providers({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ ready: false, user: null });

  useEffect(() => {
    const auth = firebaseAuth();
    if (!auth) {
      setSession({ ready: true, user: null });
      return;
    }
    return onIdTokenChanged(auth, (user) => setSession({ ready: true, user }));
  }, []);

  const getIdToken = useCallback(async () => {
    const user = firebaseAuth()?.currentUser;
    return user ? user.getIdToken() : null;
  }, []);

  return (
    <SessionContext.Provider value={session}>
      <SakerProvider
        config={appConfig}
        getIdToken={getIdToken}
        accountId={session.user?.uid ?? null}
      >
        {children}
      </SakerProvider>
    </SessionContext.Provider>
  );
}
