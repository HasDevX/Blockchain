import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuthContext } from "../contexts/AuthContext";

const NAV_ITEMS = [
  { label: "Settings", to: "/admin/settings" },
  { label: "Connections", to: "/admin/connections" },
];

export function AdminLayout() {
  const { token, clearToken } = useAuthContext();
  const location = useLocation();
  const navigate = useNavigate();

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  function handleSignOut() {
    clearToken();
    toast.success("Signed out");
    navigate("/login", { replace: true });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800/80 bg-surface-light/50 p-4 shadow-subtle">
        <nav className="flex flex-wrap gap-2 text-sm font-medium">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-full px-3 py-1 transition focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400 ${isActive ? "bg-primary-500/20 text-primary-100" : "text-slate-300 hover:text-slate-100"}`
              }
              end
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          onClick={handleSignOut}
          className="rounded-full border border-slate-700/60 px-3 py-1 text-sm text-slate-200 transition hover:border-primary-400 hover:text-primary-200 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400"
        >
          Sign out
        </button>
      </div>
      <Outlet />
    </div>
  );
}
