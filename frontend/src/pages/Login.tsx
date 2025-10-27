import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { login, ApiError } from "../lib/api";
import { useAuthContext } from "../contexts/AuthContext";
import { useSWRConfig } from "swr";

function resolveRedirectPath(state: unknown): string {
  if (state && typeof state === "object" && "from" in state && typeof (state as { from?: unknown }).from === "string") {
    return (state as { from: string }).from;
  }

  return "/admin";
}

export function LoginPage() {
  const { mutate } = useSWRConfig();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectPath = useMemo(() => resolveRedirectPath(location.state), [location.state]);
  const { token, setToken } = useAuthContext();

  const [email, setEmail] = useState("admin@explorertoken.dev");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (token) {
      navigate(redirectPath, { replace: true });
    }
  }, [token, navigate, redirectPath]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await login({ email, password });
      setToken(response.token ?? null);
      await mutate(["admin-settings", response.token ?? ""], undefined, { revalidate: true });
      toast.success("Welcome back, admin");
      navigate(redirectPath, { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401) {
          setErrorMessage("Invalid email or password. Please try again.");
        } else if (error.status === 429) {
          setErrorMessage("Too many attempts. Please wait a moment and retry.");
        } else {
          setErrorMessage("Unable to sign in right now. Please retry.");
        }
      } else {
        setErrorMessage("Unexpected error. Please retry.");
      }
    } finally {
      setSubmitting(false);
      setPassword("");
    }
  }

  return (
    <section className="mx-auto max-w-md rounded-2xl border border-slate-800/70 bg-surface-light/40 p-6 shadow-subtle">
      <h1 className="text-xl font-semibold text-slate-100">Admin login</h1>
      <p className="mt-1 text-sm text-slate-400">Sign in to manage ExplorerToken settings.</p>
      <form className="mt-4 space-y-4" onSubmit={handleSubmit} noValidate>
        <div>
          <label className="text-sm text-slate-400" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            autoComplete="username"
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
            autoComplete="current-password"
            onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 focus:border-primary-400 focus:outline-none"
            required
          />
        </div>
        {errorMessage ? <p className="text-sm text-amber-300">{errorMessage}</p> : null}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-primary-500/80 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </section>
  );
}
