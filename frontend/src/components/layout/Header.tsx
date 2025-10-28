import { useCallback } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useSWRConfig } from "swr";
import { useAuthContext } from "../../contexts/AuthContext";

const NAV_ITEMS = [
  { label: "Home", to: "/" },
  { label: "Tokens", to: "/token" },
  { label: "Dashboard", to: "/admin" },
];

export function Header() {
  const { token, clearToken } = useAuthContext();
  const navigate = useNavigate();
  const { mutate } = useSWRConfig();

  const handleLogin = useCallback(() => {
    navigate("/login");
  }, [navigate]);

  const handleLogout = useCallback(() => {
    const key = ["admin-settings", token ?? ""] as const;
    clearToken();
    void mutate(key, undefined, { revalidate: false });
    navigate("/login", { replace: true });
  }, [clearToken, mutate, navigate, token]);

  return (
    <header className="border-b border-slate-800/80 bg-surface/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex flex-wrap items-center gap-4 text-sm font-medium text-slate-400">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-full px-3 py-1 transition focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400 ${isActive ? "bg-primary-500/20 text-primary-200" : "hover:text-slate-200"}`
              }
              end={item.to === "/"}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center justify-between gap-3 text-sm sm:justify-start">
          {token ? (
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-full border border-slate-700/60 px-3 py-1 text-slate-200 transition hover:border-primary-400 hover:text-primary-200 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400"
            >
              Logout
            </button>
          ) : (
            <button
              type="button"
              onClick={handleLogin}
              className="rounded-full border border-slate-700/60 px-3 py-1 text-slate-200 transition hover:border-primary-400 hover:text-primary-200 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400"
            >
              Login
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
