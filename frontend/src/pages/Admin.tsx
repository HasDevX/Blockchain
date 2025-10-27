import { ChangeEvent, FormEvent, useState } from "react";
import toast from "react-hot-toast";
import { login } from "../lib/api";
import { clearAuthToken, getAuthToken, setAuthToken } from "../lib/auth";
import { useAdminSettings } from "../hooks/useAdminSettings";
import { Skeleton } from "../components/Skeleton";

export function AdminPage() {
  const [token, setToken] = useState<string | null>(() => getAuthToken());
  const [email, setEmail] = useState("admin@explorertoken.dev");
  const [password, setPassword] = useState("");
  const { data, isLoading, error, mutate } = useAdminSettings(token);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      const response = await login({ email, password });
      setAuthToken(response.token);
      setToken(response.token);
      await mutate();
      toast.success("Logged in as admin");
    } catch (err) {
      console.error(err);
      toast.error("Invalid credentials or rate limited");
    }
  }

  function handleLogout() {
    clearAuthToken();
    setToken(null);
    mutate(undefined, { revalidate: false });
  }

  if (!token) {
    return (
      <section className="mx-auto max-w-md rounded-2xl border border-slate-800/70 bg-surface-light/40 p-6 shadow-subtle">
        <h1 className="text-xl font-semibold text-slate-100">Admin login</h1>
        <form className="mt-4 space-y-4" onSubmit={handleLogin}>
          <div>
            <label className="text-sm text-slate-400" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 focus:border-primary-400 focus:outline-none"
              required
            />
          </div>
          <div>
            <label className="text-sm text-slate-400" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 focus:border-primary-400 focus:outline-none"
              required
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-primary-500/80 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-primary-500"
          >
            Sign in
          </button>
        </form>
      </section>
    );
  }

  if (isLoading) {
    return <Skeleton className="h-40" />;
  }

  if (error) {
    return (
      <section className="mx-auto max-w-md rounded-2xl border border-slate-800/70 bg-surface-light/40 p-6 text-center text-slate-400">
        Unable to load admin settings.
        <div className="mt-4">
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-full border border-slate-700/60 px-3 py-1 text-sm text-slate-300"
          >
            Back to login
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-xl space-y-6">
      <div className="rounded-2xl border border-slate-800/70 bg-surface-light/40 p-6 shadow-subtle">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-100">Admin settings</h1>
            <p className="text-sm text-slate-500">Last updated by {data?.settings.lastUpdatedBy}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-full border border-slate-700/60 px-3 py-1 text-sm text-slate-300"
          >
            Sign out
          </button>
        </div>
        <div className="mt-4 space-y-3 text-sm text-slate-300">
          <div className="flex items-center justify-between">
            <span>Maintenance mode</span>
            <span>{data?.settings.maintenanceMode ? "On" : "Off"}</span>
          </div>
          <div>
            <span className="text-slate-500">Announcement</span>
            <p className="mt-1 text-slate-300">{data?.settings.announcement ?? "No active announcements."}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
