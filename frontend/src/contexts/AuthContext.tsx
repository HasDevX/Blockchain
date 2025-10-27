import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  clearAuthToken as clearStoredToken,
  getAuthToken,
  setAuthToken as storeToken,
} from "../lib/auth";

type AuthContextValue = {
  token: string | null;
  setToken: (token: string | null) => void;
  clearToken: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren<unknown>) {
  const [token, setTokenState] = useState<string | null>(() => getAuthToken());

  const setToken = useCallback((value: string | null) => {
    if (value) {
      storeToken(value);
    } else {
      clearStoredToken();
    }
    setTokenState(value);
  }, []);

  const clearToken = useCallback(() => setToken(null), [setToken]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      setToken,
      clearToken,
    }),
    [token, setToken, clearToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuthContext must be used within AuthProvider");
  }

  return context;
}
