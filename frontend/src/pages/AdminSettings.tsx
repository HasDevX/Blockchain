import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { ApiError } from "../lib/api";
import { useAdminSettings } from "../hooks/useAdminSettings";
import { Skeleton } from "../components/Skeleton";
import { useAuthContext } from "../contexts/AuthContext";

export function AdminSettingsPage() {
  const { token, clearToken } = useAuthContext();
  const { data, isLoading, error, mutate } = useAdminSettings(token);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      clearToken();
      navigate("/login", { replace: true, state: { from: location.pathname } });
    }
  }, [error, clearToken, navigate, location.pathname]);

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
            onClick={() => {
              clearToken();
              mutate(undefined, { revalidate: false });
              navigate("/login", { replace: true });
            }}
            className="rounded-full border border-slate-700/60 px-3 py-1 text-sm text-slate-300"
          >
            Back to login
          </button>
        </div>
      </section>
    );
  }

  if (!data) {
    return <Skeleton className="h-40" />;
  }

  const { settings } = data;

  return (
    <section className="mx-auto max-w-xl space-y-6">
      <div className="rounded-2xl border border-slate-800/70 bg-surface-light/40 p-6 shadow-subtle">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-100">Admin settings</h1>
            <p className="text-sm text-slate-500">Last updated by {settings.lastUpdatedBy}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              clearToken();
              mutate(undefined, { revalidate: false });
              toast.success("Signed out");
              navigate("/login", { replace: true });
            }}
            className="rounded-full border border-slate-700/60 px-3 py-1 text-sm text-slate-300"
          >
            Sign out
          </button>
        </div>
        <div className="mt-4 space-y-3 text-sm text-slate-300">
          <div className="flex items-center justify-between">
            <span>Maintenance mode</span>
            <span>{settings.maintenanceMode ? "On" : "Off"}</span>
          </div>
          <div>
            <span className="text-slate-500">Announcement</span>
            <p className="mt-1 text-slate-300">
              {settings.announcement ?? "No active announcements."}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
