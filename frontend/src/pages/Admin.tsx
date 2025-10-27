import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { login, ApiError } from "../lib/api";
import { clearAuthToken, getAuthToken, setAuthToken } from "../lib/auth";
import { useAdminSettings } from "../hooks/useAdminSettings";
import { Skeleton } from "../components/Skeleton";
import { Alert } from "../components/Alert";

type FormErrorState = { message: string; variant: "error" | "warning" } | null;

export function AdminPage() {
  const [token, setToken] = useState<string | null>(() => getAuthToken());
  const [email, setEmail] = useState("admin@explorertoken.dev");
  const [password, setPassword] = useState("");
  const { data, isLoading, error, mutate } = useAdminSettings(token);
  const [loginError, setLoginError] = useState<FormErrorState>(null);

  const statusAlert = useMemo(() => {
    if (!error) {
      return null;
    }

    if (error instanceof ApiError && error.status === 401) {
      return {
        variant: "warning" as const,
        title: "Session expired",
        body: "Your admin session ended. Please sign in again.",
      };
    }

    return {
      variant: "error" as const,
      title: "Unable to load settings",
      body: "Something went wrong while fetching admin settings.",
    };
  }, [error]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError(null);

    try {
      const response = await login({ email, password });
      setAuthToken(response.token);
      setToken(response.token);
      await mutate();
      toast.success("Logged in as admin");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setLoginError({ message: "Invalid email or password.", variant: "error" });
        } else if (err.status === 429) {
          setLoginError({
            message: "Too many attempts. Wait a moment and try again.",
            variant: "warning",
          });
        } else {
          setLoginError({
            message: "Unable to sign in right now. Please retry.",
            variant: "error",
          });
        }
      } else {
        console.error(err);
        setLoginError({ message: "Unexpected error. Please retry.", variant: "error" });
      }
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
          {loginError ? (
            <Alert variant={loginError.variant}>
              <p>{loginError.message}</p>
            </Alert>
          ) : null}
          <div>
            <label className="text-sm text-slate-400" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 focus:border-primary-400 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400"
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
              autoComplete="current-password"
              value={password}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 focus:border-primary-400 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400"
              required
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-primary-500/80 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-primary-500 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-300"
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

  if (statusAlert) {
    return (
      <section className="mx-auto max-w-md rounded-2xl border border-slate-800/70 bg-surface-light/40 p-6 shadow-subtle">
        <Alert variant={statusAlert.variant} title={statusAlert.title}>
          <p>{statusAlert.body}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => mutate(undefined, { revalidate: true })}
              className="rounded-full border border-slate-700/60 px-3 py-1 text-sm text-slate-200 transition hover:border-primary-400 hover:text-primary-200 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-full border border-slate-700/60 px-3 py-1 text-sm text-slate-200 transition hover:border-primary-400 hover:text-primary-200 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400"
            >
              Back to login
            </button>
          </div>
        </Alert>
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
            className="rounded-full border border-slate-700/60 px-3 py-1 text-sm text-slate-300 transition hover:border-primary-400 hover:text-primary-200 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400"
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
            <p className="mt-1 text-slate-300">
              {data?.settings.announcement ?? "No active announcements."}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
