import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { clsx } from "clsx";
import { Table } from "../components/Table";
import { Skeleton } from "../components/Skeleton";
import { useAuthContext } from "../contexts/AuthContext";
import { useAdminConnections } from "../hooks/useAdminConnections";
import {
  ApiError,
  AdminEndpointCreatePayload,
  AdminEndpointUpdatePayload,
  AdminRpcTestPayload,
  createAdminEndpoint,
  disableAdminEndpoint,
  testAdminRpc,
  updateAdminEndpoint,
} from "../lib/api";
import { getChainMetadataById } from "../lib/chainMetadata";
import type {
  AdminConnectionChain,
  AdminConnectionEndpoint,
  AdminRpcTestResult,
} from "../types/api";

type ModalState =
  | { type: "closed" }
  | { type: "create"; chain: AdminConnectionChain }
  | { type: "edit"; chain: AdminConnectionChain; endpoint: AdminConnectionEndpoint };

type RpcTestOutcome =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "success"; tip: string; latencyMs: number }
  | { kind: "unauthorized" }
  | { kind: "error"; message: string };

type QuickTipItem = {
  title: string;
  description: string;
  href?: string;
  hrefLabel?: string;
};

type QuickTipFallback = {
  label: string;
  url: string;
  qps?: string;
  minSpan?: string;
  maxSpan?: string;
  weight?: string;
  orderIndex?: string;
};

type QuickTipsContent = {
  heading: string;
  description: string;
  tips: QuickTipItem[];
  fallback?: QuickTipFallback;
};

type EndpointFormState = {
  label: string;
  url: string;
  isPrimary: boolean;
  enabled: boolean;
  qps: string;
  minSpan: string;
  maxSpan: string;
  weight: string;
  orderIndex: string;
};

type FormErrors = Partial<Record<keyof EndpointFormState, string>> & { form?: string };

const DEFAULT_FORM: EndpointFormState = {
  label: "",
  url: "",
  isPrimary: false,
  enabled: true,
  qps: "1",
  minSpan: "8",
  maxSpan: "1000",
  weight: "1",
  orderIndex: "0",
};

export function AdminConnectionsPage() {
  const { token, clearToken } = useAuthContext();
  const navigate = useNavigate();
  const location = useLocation();
  const { data, error, isLoading, mutate } = useAdminConnections(token);
  const [modalState, setModalState] = useState<ModalState>({ type: "closed" });
  const [formState, setFormState] = useState<EndpointFormState>(DEFAULT_FORM);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [testingEndpointId, setTestingEndpointId] = useState<string | null>(null);
  const [endpointStatuses, setEndpointStatuses] = useState<Record<string, RpcTestOutcome>>({});
  const [modalTestState, setModalTestState] = useState<RpcTestOutcome>({ kind: "idle" });
  const [primaryUpdatingId, setPrimaryUpdatingId] = useState<string | null>(null);
  const [showQuickTips, setShowQuickTips] = useState(false);

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      clearToken();
      navigate("/login", { replace: true, state: { from: location.pathname } });
    }
  }, [error, clearToken, navigate, location.pathname]);

  useEffect(() => {
    if (modalState.type === "closed") {
      setFormState(DEFAULT_FORM);
      setFormErrors({});
      setModalTestState({ kind: "idle" });
    } else if (modalState.type === "edit") {
      const { endpoint } = modalState;
      setFormState({
        label: endpoint.label ?? "",
        url: endpoint.url,
        isPrimary: endpoint.isPrimary,
        enabled: endpoint.enabled,
        qps: String(endpoint.qps ?? ""),
        minSpan: String(endpoint.minSpan ?? ""),
        maxSpan: String(endpoint.maxSpan ?? ""),
        weight: String(endpoint.weight ?? ""),
        orderIndex: String(endpoint.orderIndex ?? ""),
      });
      setFormErrors({});
      setModalTestState({ kind: "idle" });
      setShowQuickTips(false);
    } else if (modalState.type === "create") {
      setFormState(DEFAULT_FORM);
      setFormErrors({});
      setModalTestState({ kind: "idle" });
      setShowQuickTips(false);
    }
  }, [modalState]);

  const chains = useMemo(() => data?.chains ?? [], [data]);

  const quickTips = useMemo(() => {
    if (modalState.type === "closed") {
      return null;
    }

    return getQuickTipContent(modalState.chain.chainId);
  }, [modalState]);

  if (isLoading) {
    return <Skeleton className="h-80" />;
  }

  if (error && !(error instanceof ApiError && error.status === 401)) {
    return (
      <section className="rounded-2xl border border-slate-800/70 bg-surface-light/40 p-8 text-center text-slate-300">
        <h2 className="text-lg font-semibold text-slate-100">Unable to load connections</h2>
        <p className="mt-2 text-sm text-slate-400">Please check your connection and try again.</p>
        <div className="mt-4">
          <button
            type="button"
            onClick={() => mutate()}
            className="rounded-full border border-slate-700/60 px-3 py-1 text-sm text-slate-200"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-slate-100">Chain connections</h1>
        <p className="text-sm text-slate-400">
          Manage RPC endpoints, update limits, and test connectivity for each supported network.
        </p>
      </header>

      {chains.length === 0 ? (
        <div className="rounded-2xl border border-slate-800/70 bg-slate-900/40 p-8 text-center text-slate-400">
          No chain configurations found.
        </div>
      ) : (
        <div className="space-y-6">
          {chains.map((chain) => (
            <ChainConnectionsCard
              key={chain.chainId}
              chain={chain}
              onAddEndpoint={() => setModalState({ type: "create", chain })}
              onEditEndpoint={(endpoint) => setModalState({ type: "edit", chain, endpoint })}
              onTestEndpoint={async (endpoint) => {
                await handleTestEndpoint(chain, endpoint);
              }}
              onToggleEndpoint={async (endpoint) => {
                await handleToggleEndpoint(chain, endpoint);
              }}
              onSetPrimary={async (endpoint) => {
                await handleSetPrimary(chain, endpoint);
              }}
              isTesting={(endpointId) => testingEndpointId === endpointId}
              isPrimaryUpdating={(endpointId) => primaryUpdatingId === endpointId}
              statusForEndpoint={(endpointId) => endpointStatuses[endpointId]}
            />
          ))}
        </div>
      )}

      <EndpointModal
        state={modalState}
        formState={formState}
        formErrors={formErrors}
        isSubmitting={isSubmitting}
        onClose={() => setModalState({ type: "closed" })}
        onChange={(field, value) => {
          setFormState((previous) => ({ ...previous, [field]: value }));
          setFormErrors((previous) => ({ ...previous, [field]: undefined, form: undefined }));
        }}
        onSubmit={async () => {
          if (modalState.type === "create") {
            await handleSubmitCreate(modalState.chain);
          } else if (modalState.type === "edit") {
            await handleSubmitUpdate(modalState.chain, modalState.endpoint);
          }
        }}
        onTestRpc={async () => {
          if (modalState.type === "create") {
            await handleModalTest(modalState.chain);
          } else if (modalState.type === "edit") {
            await handleModalTest(modalState.chain);
          }
        }}
        testState={modalTestState}
        showTips={showQuickTips}
        onToggleTips={() => setShowQuickTips((value) => !value)}
        quickTips={quickTips}
        onApplyFallback={(fallback) => {
          setFormState((previous) => ({
            ...previous,
            label: fallback.label,
            url: fallback.url,
            qps: fallback.qps ?? previous.qps,
            minSpan: fallback.minSpan ?? previous.minSpan,
            maxSpan: fallback.maxSpan ?? previous.maxSpan,
            weight: fallback.weight ?? previous.weight,
            orderIndex: fallback.orderIndex ?? previous.orderIndex,
          }));
          setFormErrors((previous) => ({ ...previous, form: undefined }));
          setModalTestState({ kind: "idle" });
        }}
      />
    </section>
  );

  async function handleTestEndpoint(
    chain: AdminConnectionChain,
    endpoint: AdminConnectionEndpoint,
  ) {
    if (!token) {
      toast.error("Missing admin token");
      return;
    }

    const payload: AdminRpcTestPayload = {
      url: endpoint.url,
      chainId: chain.chainId,
      endpointId: endpoint.id,
    };

    setTestingEndpointId(endpoint.id);
    setEndpointStatuses((previous) => ({ ...previous, [endpoint.id]: { kind: "pending" } }));

    try {
      const result = await testAdminRpc(payload, token);
      const outcome = mapRpcResultToOutcome(result);
      setEndpointStatuses((previous) => ({ ...previous, [endpoint.id]: outcome }));

      if (result.ok) {
        toast.success(`RPC healthy • tip ${result.tip} • ${result.latencyMs} ms`);
      } else if (outcome.kind === "unauthorized") {
        toast.error("Unauthorized (check API key)");
      } else if (outcome.kind === "error") {
        toast.error(outcome.message);
      }

      await mutate();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setEndpointStatuses((previous) => ({
          ...previous,
          [endpoint.id]: { kind: "unauthorized" },
        }));
        clearToken();
        navigate("/login", { replace: true, state: { from: location.pathname } });
        return;
      }

      const outcome = mapRpcErrorToOutcome(err);
      setEndpointStatuses((previous) => ({ ...previous, [endpoint.id]: outcome }));
      toast.error(outcome.kind === "error" ? outcome.message : "Unable to test endpoint");
      console.error(err);

      await mutate();
    } finally {
      setTestingEndpointId(null);
    }
  }

  async function handleModalTest(chain: AdminConnectionChain) {
    const trimmedUrl = formState.url.trim();

    if (!trimmedUrl) {
      setFormErrors((previous) => ({ ...previous, url: "URL is required" }));
      return;
    }

    if (!token) {
      toast.error("Missing admin token");
      return;
    }

    const payload: AdminRpcTestPayload = {
      url: trimmedUrl,
      chainId: chain.chainId,
    };

    setModalTestState({ kind: "pending" });

    try {
      const result = await testAdminRpc(payload, token);
      const outcome = mapRpcResultToOutcome(result);
      setModalTestState(outcome);

      if (result.ok) {
        toast.success(`RPC healthy • tip ${result.tip} • ${result.latencyMs} ms`);
      } else if (outcome.kind === "unauthorized") {
        toast.error("Unauthorized (check API key)");
      } else if (outcome.kind === "error") {
        toast.error(outcome.message);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearToken();
        navigate("/login", { replace: true, state: { from: location.pathname } });
        setModalTestState({ kind: "unauthorized" });
        return;
      }

      const outcome = mapRpcErrorToOutcome(err);
      setModalTestState(outcome);
      toast.error(outcome.kind === "error" ? outcome.message : "Unable to test endpoint");
      console.error(err);
    }
  }

  async function handleToggleEndpoint(
    chain: AdminConnectionChain,
    endpoint: AdminConnectionEndpoint,
  ) {
    if (!token) {
      toast.error("Missing admin token");
      return;
    }

    if (endpoint.enabled) {
      const confirmed = window.confirm(
        "Disable this endpoint? It will no longer receive traffic until re-enabled.",
      );

      if (!confirmed) {
        return;
      }

      try {
        await disableAdminEndpoint(chain.chainId, endpoint.id, token);
        toast.success("Endpoint disabled");
        await mutate();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearToken();
          navigate("/login", { replace: true, state: { from: location.pathname } });
          return;
        }

        toast.error("Failed to disable endpoint");
        console.error(err);
      }

      return;
    }

    try {
      await updateAdminEndpoint(chain.chainId, endpoint.id, { enabled: true }, token);
      toast.success("Endpoint enabled");
      await mutate();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearToken();
        navigate("/login", { replace: true, state: { from: location.pathname } });
        return;
      }

      toast.error("Failed to enable endpoint");
      console.error(err);
    }
  }

  async function handleSetPrimary(chain: AdminConnectionChain, endpoint: AdminConnectionEndpoint) {
    if (endpoint.isPrimary) {
      return;
    }

    if (!token) {
      toast.error("Missing admin token");
      return;
    }

    setPrimaryUpdatingId(endpoint.id);

    try {
      await updateAdminEndpoint(chain.chainId, endpoint.id, { isPrimary: true }, token);
      toast.success(`${endpoint.label ?? "Endpoint"} set as primary`);
      await mutate();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearToken();
        navigate("/login", { replace: true, state: { from: location.pathname } });
        return;
      }

      toast.error("Failed to set primary endpoint");
      console.error(err);
    } finally {
      setPrimaryUpdatingId(null);
    }
  }

  function validateForm(): FormErrors {
    const errors: FormErrors = {};
    const label = formState.label.trim();
    const trimmedUrl = formState.url.trim();

    if (label.length > 80) {
      errors.label = "Label must be 80 characters or fewer";
    }

    if (!trimmedUrl) {
      errors.url = "URL is required";
    } else if (!/^https?:\/\//i.test(trimmedUrl)) {
      errors.url = "URL must start with http or https";
    }

    const qps = parseInteger(formState.qps);
    if (qps === null || qps < 0) {
      errors.qps = "QPS must be zero or a positive integer";
    }

    const minSpan = parseInteger(formState.minSpan);
    if (minSpan === null || minSpan < 1) {
      errors.minSpan = "Min span must be at least 1";
    }

    const maxSpan = parseInteger(formState.maxSpan);
    if (maxSpan === null || maxSpan < 1) {
      errors.maxSpan = "Max span must be at least 1";
    } else if (minSpan !== null && maxSpan < minSpan) {
      errors.maxSpan = "Max span must be greater than or equal to min span";
    }

    const weight = parseInteger(formState.weight);
    if (weight === null || weight < 1) {
      errors.weight = "Weight must be at least 1";
    }

    const orderIndex = parseInteger(formState.orderIndex);
    if (orderIndex === null || orderIndex < 0) {
      errors.orderIndex = "Order must be zero or a positive integer";
    }

    return errors;
  }

  async function handleSubmitCreate(chain: AdminConnectionChain) {
    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    if (!token) {
      toast.error("Missing admin token");
      return;
    }

    const payload: AdminEndpointCreatePayload = buildCreatePayload(formState);

    setIsSubmitting(true);

    try {
      await createAdminEndpoint(chain.chainId, payload, token);
      toast.success("Endpoint created");
      setModalState({ type: "closed" });
      await mutate();
    } catch (err) {
      handleSubmissionError(err, "Failed to create endpoint");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmitUpdate(
    chain: AdminConnectionChain,
    endpoint: AdminConnectionEndpoint,
  ) {
    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    if (!token) {
      toast.error("Missing admin token");
      return;
    }

    const payload = buildUpdatePayload(formState, endpoint);

    if (Object.keys(payload).length === 0) {
      setFormErrors({ form: "No changes detected" });
      return;
    }

    setIsSubmitting(true);

    try {
      await updateAdminEndpoint(chain.chainId, endpoint.id, payload, token);
      toast.success("Endpoint updated");
      setModalState({ type: "closed" });
      await mutate();
    } catch (err) {
      handleSubmissionError(err, "Failed to update endpoint");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSubmissionError(err: unknown, fallback: string) {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        clearToken();
        navigate("/login", { replace: true, state: { from: location.pathname } });
        return;
      }

      if (err.status === 400 && typeof err.body === "object" && err.body && "error" in err.body) {
        setFormErrors({ form: String((err.body as { error?: string }).error ?? fallback) });
        return;
      }

      toast.error(err.body ? `${fallback}: ${JSON.stringify(err.body)}` : fallback);
      return;
    }

    toast.error(fallback);
    console.error(err);
  }
}

function ChainConnectionsCard({
  chain,
  onAddEndpoint,
  onEditEndpoint,
  onTestEndpoint,
  onToggleEndpoint,
  onSetPrimary,
  isTesting,
  isPrimaryUpdating,
  statusForEndpoint,
}: {
  chain: AdminConnectionChain;
  onAddEndpoint: () => void;
  onEditEndpoint: (endpoint: AdminConnectionEndpoint) => void;
  onTestEndpoint: (endpoint: AdminConnectionEndpoint) => Promise<void>;
  onToggleEndpoint: (endpoint: AdminConnectionEndpoint) => Promise<void>;
  onSetPrimary: (endpoint: AdminConnectionEndpoint) => Promise<void>;
  isTesting: (endpointId: string) => boolean;
  isPrimaryUpdating: (endpointId: string) => boolean;
  statusForEndpoint: (endpointId: string) => RpcTestOutcome | undefined;
}) {
  const metadata = getChainMetadataById(chain.chainId);
  const title = metadata?.name ?? chain.name;
  const subtitle =
    metadata?.shortName && metadata.shortName !== metadata.name ? metadata.shortName : null;

  return (
    <div className="space-y-4 rounded-2xl border border-slate-800/70 bg-surface-light/40 p-6 shadow-subtle">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
          <p className="text-sm text-slate-500">
            {subtitle ? `${subtitle} • ` : ""}
            {chain.endpoints.length} endpoint{chain.endpoints.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          type="button"
          onClick={onAddEndpoint}
          className="rounded-full border border-primary-400/70 px-3 py-1 text-sm text-primary-100 transition hover:border-primary-300 hover:text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400"
        >
          Add endpoint
        </button>
      </div>

      <Table
        data={chain.endpoints}
        getRowKey={(row) => row.id}
        columns={[
          {
            key: "label",
            header: "Label",
            render: (endpoint) => (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-100">{endpoint.label ?? "—"}</span>
                  {endpoint.isPrimary ? (
                    <span className="inline-flex items-center rounded-full bg-primary-500/20 px-2 py-0.5 text-xs font-semibold text-primary-100">
                      Primary
                    </span>
                  ) : null}
                  {!endpoint.enabled ? (
                    <span className="inline-flex items-center rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-200">
                      Disabled
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-slate-500">
                  Updated {formatTimeAgo(endpoint.updatedAt)}
                </div>
              </div>
            ),
            className: "w-56",
          },
          {
            key: "url",
            header: "RPC URL",
            render: (endpoint) => (
              <span
                className="block max-w-[18rem] truncate text-sm text-slate-200"
                title={endpoint.url}
              >
                {endpoint.url}
              </span>
            ),
            className: "w-60",
          },
          {
            key: "primary",
            header: "Primary",
            render: (endpoint) => {
              const updating = isPrimaryUpdating(endpoint.id);
              return (
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="radio"
                    name={`primary-${chain.chainId}`}
                    checked={endpoint.isPrimary}
                    disabled={endpoint.isPrimary || updating}
                    onChange={() => {
                      void onSetPrimary(endpoint);
                    }}
                    className="h-4 w-4 accent-primary-400"
                  />
                  <span>
                    {endpoint.isPrimary ? "Primary" : updating ? "Saving…" : "Set primary"}
                  </span>
                </label>
              );
            },
            className: "w-44",
          },
          {
            key: "limits",
            header: "Limits",
            render: (endpoint) => (
              <div className="text-sm text-slate-200">
                <div>QPS {endpoint.qps}</div>
                <div className="text-xs text-slate-500">
                  Span {endpoint.minSpan} → {endpoint.maxSpan}
                </div>
              </div>
            ),
            className: "w-40",
          },
          {
            key: "weight",
            header: "Distribution",
            render: (endpoint) => (
              <div className="text-sm text-slate-200">
                <div>Weight {endpoint.weight}</div>
                <div className="text-xs text-slate-500">Order {endpoint.orderIndex}</div>
              </div>
            ),
            className: "w-36",
          },
          {
            key: "health",
            header: "Last health",
            render: (endpoint) => (
              <div className="text-sm text-slate-200">
                <div>{endpoint.lastHealth ?? "Unknown"}</div>
                <div className="text-xs text-slate-500">
                  {endpoint.lastCheckedAt ? (
                    <>Checked {formatTimeAgo(endpoint.lastCheckedAt)}</>
                  ) : (
                    "Not checked"
                  )}
                </div>
              </div>
            ),
            className: "w-48",
          },
          {
            key: "status",
            header: "Test status",
            render: (endpoint) => renderOutcomeBadge(statusForEndpoint(endpoint.id)),
            className: "w-56",
          },
          {
            key: "actions",
            header: "Actions",
            render: (endpoint) => (
              <div className="flex flex-wrap gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => onTestEndpoint(endpoint)}
                  className="rounded-full border border-slate-700/60 px-2 py-1 text-xs text-slate-200 transition hover:border-primary-400 hover:text-primary-200 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400"
                  disabled={isTesting(endpoint.id)}
                >
                  {isTesting(endpoint.id) ? "Testing…" : "Test RPC"}
                </button>
                <button
                  type="button"
                  onClick={() => onEditEndpoint(endpoint)}
                  className="rounded-full border border-slate-700/60 px-2 py-1 text-xs text-slate-200 transition hover:border-primary-400 hover:text-primary-200 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onToggleEndpoint(endpoint)}
                  className={clsx(
                    "rounded-full px-2 py-1 text-xs transition focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                    endpoint.enabled
                      ? "border border-amber-500/40 text-amber-200 hover:border-amber-400 hover:text-amber-100 focus-visible:outline-amber-400"
                      : "border border-emerald-500/40 text-emerald-200 hover:border-emerald-400 hover:text-emerald-100 focus-visible:outline-emerald-400",
                  )}
                >
                  {endpoint.enabled ? "Disable" : "Enable"}
                </button>
              </div>
            ),
            className: "w-48",
          },
        ]}
        emptyState={<span className="text-sm text-slate-400">No endpoints configured.</span>}
      />
    </div>
  );
}

function EndpointModal({
  state,
  formState,
  formErrors,
  isSubmitting,
  onClose,
  onChange,
  onSubmit,
  onTestRpc,
  testState,
  showTips,
  onToggleTips,
  quickTips,
  onApplyFallback,
}: {
  state: ModalState;
  formState: EndpointFormState;
  formErrors: FormErrors;
  isSubmitting: boolean;
  onClose: () => void;
  onChange: (
    field: keyof EndpointFormState,
    value: EndpointFormState[keyof EndpointFormState],
  ) => void;
  onSubmit: () => Promise<void>;
  onTestRpc: () => Promise<void>;
  testState: RpcTestOutcome;
  showTips: boolean;
  onToggleTips: () => void;
  quickTips: QuickTipsContent | null;
  onApplyFallback: (fallback: QuickTipFallback) => void;
}) {
  const isOpen = state.type !== "closed";
  const isEdit = state.type === "edit";

  if (!isOpen) {
    return null;
  }

  const title = isEdit ? "Edit endpoint" : `Add endpoint — ${state.chain.name}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-800/80 bg-slate-900/90 p-6 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
            <p className="text-sm text-slate-500">
              Provide the RPC details, set limits, and optionally test connectivity before saving.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {quickTips ? (
              <button
                type="button"
                onClick={onToggleTips}
                className="rounded-full border border-slate-700/60 px-3 py-1 text-xs text-slate-200 transition hover:border-primary-400 hover:text-primary-100 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400"
              >
                {showTips ? "Hide Quick Tips" : "Show Quick Tips"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-700/60 px-3 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
            >
              Close
            </button>
          </div>
        </div>

        {showTips && quickTips ? (
          <QuickTipsPanel content={quickTips} onApplyFallback={onApplyFallback} />
        ) : null}

        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit();
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="endpoint-label">
                Label
              </label>
              <input
                id="endpoint-label"
                type="text"
                className={inputClass(formErrors.label)}
                maxLength={80}
                value={formState.label}
                onChange={(event) => onChange("label", event.target.value)}
                placeholder="Primary QuickNode"
              />
              {formErrors.label ? (
                <p className="mt-1 text-xs text-rose-400">{formErrors.label}</p>
              ) : null}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="endpoint-url">
                Endpoint URL
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="endpoint-url"
                  type="url"
                  className={inputClass(formErrors.url)}
                  value={formState.url}
                  onChange={(event) => onChange("url", event.target.value)}
                  placeholder="https://example.quiknode.pro/..."
                  required
                />
                <button
                  type="button"
                  onClick={() => {
                    void onTestRpc();
                  }}
                  className="whitespace-nowrap rounded-xl border border-primary-400/70 px-3 py-2 text-xs font-medium text-primary-100 transition hover:border-primary-300 hover:text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={testState.kind === "pending" || isSubmitting}
                >
                  {testState.kind === "pending" ? "Testing…" : "Test RPC"}
                </button>
              </div>
              {formErrors.url ? (
                <p className="mt-1 text-xs text-rose-400">{formErrors.url}</p>
              ) : null}
              <div className="mt-2 text-xs text-slate-400">{renderOutcomeBadge(testState)}</div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <ToggleField
              id="endpoint-primary"
              label="Primary endpoint"
              helpText="Primary endpoints handle priority traffic."
              checked={formState.isPrimary}
              onChange={(value) => onChange("isPrimary", value)}
            />
            <ToggleField
              id="endpoint-enabled"
              label="Enabled"
              helpText="Disabled endpoints are ignored until re-enabled."
              checked={formState.enabled}
              onChange={(value) => onChange("enabled", value)}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <NumberField
              id="endpoint-qps"
              label="Requests per second"
              value={formState.qps}
              onChange={(value) => onChange("qps", value)}
              error={formErrors.qps}
              min={0}
            />
            <NumberField
              id="endpoint-weight"
              label="Weight"
              value={formState.weight}
              onChange={(value) => onChange("weight", value)}
              error={formErrors.weight}
              min={1}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <NumberField
              id="endpoint-min-span"
              label="Min span"
              value={formState.minSpan}
              onChange={(value) => onChange("minSpan", value)}
              error={formErrors.minSpan}
              min={1}
            />
            <NumberField
              id="endpoint-max-span"
              label="Max span"
              value={formState.maxSpan}
              onChange={(value) => onChange("maxSpan", value)}
              error={formErrors.maxSpan}
              min={1}
            />
          </div>

          <NumberField
            id="endpoint-order"
            label="Order index"
            value={formState.orderIndex}
            onChange={(value) => onChange("orderIndex", value)}
            error={formErrors.orderIndex}
            min={0}
          />

          {formErrors.form ? (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {formErrors.form}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-700/60 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:text-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-full border border-primary-400/70 bg-primary-500/20 px-4 py-2 text-sm font-medium text-primary-100 transition hover:border-primary-300 hover:text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Saving…" : isEdit ? "Save changes" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function QuickTipsPanel({
  content,
  onApplyFallback,
}: {
  content: QuickTipsContent;
  onApplyFallback: (fallback: QuickTipFallback) => void;
}) {
  return (
    <div className="mt-6 rounded-2xl border border-primary-400/30 bg-primary-500/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl space-y-2">
          <div>
            <h4 className="text-sm font-semibold text-primary-100">{content.heading}</h4>
            <p className="text-xs text-primary-200/80">{content.description}</p>
          </div>

          <ul className="space-y-2 text-xs text-primary-100/90">
            {content.tips.map((tip, index) => (
              <li
                key={index}
                className="rounded-xl border border-primary-400/40 bg-primary-500/10 px-3 py-2"
              >
                <p className="font-medium text-primary-100">{tip.title}</p>
                <p className="text-primary-200/80">{tip.description}</p>
                {tip.href ? (
                  <a
                    href={tip.href}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex text-primary-200 underline decoration-dotted"
                  >
                    {tip.hrefLabel ?? "View reference"}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
        {content.fallback ? (
          <button
            type="button"
            onClick={() => onApplyFallback(content.fallback!)}
            className="rounded-xl border border-primary-400/60 bg-primary-500/20 px-3 py-2 text-xs font-semibold text-primary-100 transition hover:border-primary-300 hover:text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400"
          >
            Apply recommended defaults
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ToggleField({
  id,
  label,
  helpText,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  helpText: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-800/70 bg-slate-950/40 px-3 py-3">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border border-slate-700 bg-slate-900 text-primary-500 focus:ring-primary-400"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <label htmlFor={id} className="cursor-pointer">
          <span className="block text-sm font-medium text-slate-100">{label}</span>
          <span className="text-xs text-slate-500">{helpText}</span>
        </label>
      </div>
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  error,
  min,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  min?: number;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-200" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        className={inputClass(error)}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        min={min}
      />
      {error ? <p className="mt-1 text-xs text-rose-400">{error}</p> : null}
    </div>
  );
}

function inputClass(error?: string) {
  return clsx(
    "mt-1 w-full rounded-xl border bg-slate-950/60 px-3 py-2 text-sm text-slate-200 shadow-inner transition focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400",
    error ? "border-rose-500/60" : "border-slate-800/70",
  );
}

function formatTimeAgo(value: string | null) {
  if (!value) {
    return "never";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const now = Date.now();
  const diff = now - date.getTime();

  if (diff < 1000 * 60) {
    const seconds = Math.max(1, Math.round(diff / 1000));
    return `${seconds}s ago`;
  }

  if (diff < 1000 * 60 * 60) {
    const minutes = Math.round(diff / (1000 * 60));
    return `${minutes}m ago`;
  }

  if (diff < 1000 * 60 * 60 * 24) {
    const hours = Math.round(diff / (1000 * 60 * 60));
    return `${hours}h ago`;
  }

  const days = Math.round(diff / (1000 * 60 * 60 * 24));
  return `${days}d ago`;
}

function parseInteger(value: string): number | null {
  if (value.trim().length === 0) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function buildCreatePayload(form: EndpointFormState): AdminEndpointCreatePayload {
  const payload: AdminEndpointCreatePayload = {
    url: form.url.trim(),
    isPrimary: form.isPrimary,
    enabled: form.enabled,
    qps: parseInteger(form.qps) ?? 0,
    minSpan: parseInteger(form.minSpan) ?? 1,
    maxSpan: parseInteger(form.maxSpan) ?? Math.max(parseInteger(form.minSpan) ?? 1, 1000),
    weight: parseInteger(form.weight) ?? 1,
    orderIndex: parseInteger(form.orderIndex) ?? 0,
  };

  const label = form.label.trim();
  if (label.length > 0) {
    payload.label = label;
  }

  return payload;
}

function buildUpdatePayload(
  form: EndpointFormState,
  endpoint: AdminConnectionEndpoint,
): AdminEndpointUpdatePayload {
  const payload: AdminEndpointUpdatePayload = {};
  const label = form.label.trim();
  if (label !== (endpoint.label ?? "")) {
    payload.label = label.length > 0 ? label : null;
  }

  const url = form.url.trim();
  if (url && url !== endpoint.url) {
    payload.url = url;
  }

  const qps = parseInteger(form.qps);
  if (qps !== null && qps !== endpoint.qps) {
    payload.qps = qps;
  }

  const minSpan = parseInteger(form.minSpan);
  if (minSpan !== null && minSpan !== endpoint.minSpan) {
    payload.minSpan = minSpan;
  }

  const maxSpan = parseInteger(form.maxSpan);
  if (maxSpan !== null && maxSpan !== endpoint.maxSpan) {
    payload.maxSpan = maxSpan;
  }

  const weight = parseInteger(form.weight);
  if (weight !== null && weight !== endpoint.weight) {
    payload.weight = weight;
  }

  const orderIndex = parseInteger(form.orderIndex);
  if (orderIndex !== null && orderIndex !== endpoint.orderIndex) {
    payload.orderIndex = orderIndex;
  }

  if (form.enabled !== endpoint.enabled) {
    payload.enabled = form.enabled;
  }

  if (form.isPrimary !== endpoint.isPrimary) {
    payload.isPrimary = form.isPrimary;
  }

  return payload;
}

function mapRpcResultToOutcome(result: AdminRpcTestResult): RpcTestOutcome {
  if (result.ok) {
    return {
      kind: "success",
      tip: result.tip,
      latencyMs: result.latencyMs,
    };
  }

  if (result.status === 401) {
    return { kind: "unauthorized" };
  }

  return {
    kind: "error",
    message: result.message ? `${result.error}: ${result.message}` : result.error,
  };
}

function mapRpcErrorToOutcome(error: unknown): RpcTestOutcome {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return { kind: "unauthorized" };
    }

    const description =
      typeof error.body === "object" && error.body && "error" in error.body
        ? String((error.body as { error?: string }).error ?? error.message)
        : error.message;

    return { kind: "error", message: description || "Unexpected RPC error" };
  }

  if (error instanceof Error) {
    return { kind: "error", message: error.message || "Unexpected RPC error" };
  }

  return { kind: "error", message: "Unexpected RPC error" };
}

function renderOutcomeBadge(outcome?: RpcTestOutcome) {
  const state = outcome ?? { kind: "idle" };

  switch (state.kind) {
    case "pending":
      return (
        <span className="inline-flex items-center rounded-full border border-primary-400/50 bg-primary-500/10 px-3 py-1 text-xs font-semibold text-primary-100">
          Testing…
        </span>
      );
    case "success":
      return (
        <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-100">
          Healthy • tip {state.tip} • {state.latencyMs} ms
        </span>
      );
    case "unauthorized":
      return (
        <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-100">
          Unauthorized
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center rounded-full border border-rose-500/40 bg-rose-500/15 px-3 py-1 text-xs font-semibold text-rose-200">
          {state.message}
        </span>
      );
    case "idle":
    default:
      return (
        <span className="inline-flex items-center rounded-full border border-slate-700/60 bg-slate-900/60 px-3 py-1 text-xs font-semibold text-slate-300">
          Not tested
        </span>
      );
  }
}

const QUICK_TIPS: Record<number, QuickTipsContent> = {
  1: {
    heading: "Recommended settings for Ethereum Mainnet",
    description:
      "Pair your QuickNode primary with a throttled public fallback so hot reloads stay healthy during provider incidents.",
    tips: [
      {
        title: "QuickNode primary URL",
        description:
          "Copy the HTTPS endpoint from your QuickNode dashboard (format: https://<region>.ethereum.quiknode.pro/<API_KEY>/).",
        href: "https://www.quicknode.com/docs/ethereum",
        hrefLabel: "QuickNode guide",
      },
      {
        title: "Public fallback defaults",
        description:
          "Use Apply recommended defaults to add Ankr's shared RPC with low concurrency so it only engages during outages.",
      },
    ],
    fallback: {
      label: "Ankr Fallback",
      url: "https://rpc.ankr.com/eth/YOUR-KEY/",
      qps: "1",
      minSpan: "8",
      maxSpan: "1000",
      weight: "1",
      orderIndex: "1",
    },
  },
  137: {
    heading: "Recommended settings for Polygon",
    description:
      "Keep your QuickNode primary online and add the public Polygon RPC as a gentle fallback with low request pressure.",
    tips: [
      {
        title: "QuickNode primary URL",
        description:
          "Format: https://<region>.polygon.quiknode.pro/<API_KEY>/ (include your key and trailing slash).",
        href: "https://www.quicknode.com/docs/polygon",
      },
      {
        title: "Public fallback defaults",
        description:
          "Apply the Polygon public RPC with QPS=1 and span 8-1000 so it steps in without exhausting shared capacity.",
      },
    ],
    fallback: {
      label: "Polygon Public RPC",
      url: "https://polygon-rpc.com",
      qps: "1",
      minSpan: "8",
      maxSpan: "1000",
      weight: "1",
      orderIndex: "1",
    },
  },
  42161: {
    heading: "Recommended settings for Arbitrum One",
    description:
      "Run a QuickNode primary and layered public fallback so Nitro sequencing hiccups don't stall ingestion.",
    tips: [
      {
        title: "QuickNode primary URL",
        description:
          "Use https://arbitrum-mainnet.quiknode.pro/<API_KEY>/ (or your region of choice) as the priority endpoint.",
        href: "https://www.quicknode.com/docs/arbitrum",
      },
      {
        title: "Public fallback defaults",
        description:
          "Apply the Arbitrum One public RPC with 1 QPS and wide spans so it only handles occasional failover traffic.",
      },
    ],
    fallback: {
      label: "Arbitrum Public RPC",
      url: "https://arb1.arbitrum.io/rpc",
      qps: "1",
      minSpan: "8",
      maxSpan: "1000",
      weight: "1",
      orderIndex: "1",
    },
  },
};

function getQuickTipContent(chainId: number): QuickTipsContent | null {
  return QUICK_TIPS[chainId] ?? null;
}
