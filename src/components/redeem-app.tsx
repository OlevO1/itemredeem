"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Script from "next/script";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Coins,
  Loader2,
  LogOut,
  Minus,
  Plus,
  Radio,
  ShoppingBag,
  User,
  X,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TooltipProvider,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type AuthStatus = {
  authenticated: boolean;
  configured: boolean;
  scope: string | null;
  expiresAt: number | null;
  userName: string | null;
  userId: number | null;
  redeemDelayMs: number;
  maxQuantity: number;
};

type ShopItem = {
  id: string;
  name: string;
  command: string;
  price: number | null;
  stock: number | null;
};

type RedeemJob = {
  id: string;
  status: "scheduled" | "proxy_wait" | "queued" | "running" | "done" | "failed" | "canceled";
  itemName: string;
  command: string;
  total: number;
  attempted: number;
  sent: number;
  failed: number;
  delayMs: number;
  estimatedSeconds: number;
  logs: string[];
  scheduledFor?: string;
  proxyStatus?: ProxyStatus;
  error: string | null;
};

type ProxyStatus = {
  ok: boolean;
  state: "operational" | "proxy_error" | "unknown";
  title: string;
  summary: string;
  publishedAt: string | null;
  checkedAt: string;
};

type PointsState = {
  loading: boolean;
  found: boolean;
  points: number;
  error: string | null;
};

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      theme?: "dark" | "light" | "auto";
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const statusLabels: Record<RedeemJob["status"], string> = {
  scheduled: "ütemezve",
  proxy_wait: "proxyra vár",
  queued: "várakozik",
  running: "fut",
  done: "kész",
  failed: "hiba",
  canceled: "megszakítva",
};

const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";
const turnstileLocalSiteKey = "1x00000000000000000000AA";

function isActiveJob(job: RedeemJob) {
  return (
    job.status === "scheduled" ||
    job.status === "proxy_wait" ||
    job.status === "queued" ||
    job.status === "running"
  );
}

export function RedeemApp() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [items, setItems] = useState<ShopItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [jobs, setJobs] = useState<RedeemJob[]>([]);
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus | null>(null);
  const [loadingItems, setLoadingItems] = useState(true);
  const [starting, setStarting] = useState(false);
  const [cancelingJobId, setCancelingJobId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [points, setPoints] = useState<PointsState>({
    loading: false,
    found: false,
    points: 0,
    error: null,
  });

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) || null,
    [items, selectedItemId],
  );
  const selectedPrice = Math.max(0, Number(selectedItem?.price || 0));
  const estimatedSeconds =
    quantity * Math.max(1, Math.round((auth?.redeemDelayMs || 5000) / 1000));
  const totalCost = selectedPrice * quantity;
  const activeJobs = jobs.filter(isActiveJob);
  const activeJobKey = activeJobs
    .map((nextJob) => `${nextJob.id}:${nextJob.status}`)
    .join("|");
  const hasActiveJobs = activeJobs.length > 0;
  const hasSlowActiveJob = activeJobs.some(
    (nextJob) => nextJob.status === "scheduled" || nextJob.status === "proxy_wait",
  );
  const maxByPoints =
    selectedPrice > 0 ? Math.floor(points.points / selectedPrice) : 0;
  const canStart =
    Boolean(auth?.authenticated && selectedItem && quantity > 0 && turnstileToken) &&
    !starting;

  const loadProxyStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/redeem/proxy-status", {
        cache: "no-store",
      });
      const data = (await response.json()) as {
        proxyStatus?: ProxyStatus;
      };

      if (data.proxyStatus) {
        setProxyStatus(data.proxyStatus);
      }
    } catch {
      setProxyStatus({
        ok: false,
        state: "unknown",
        title: "Proxy státusz hiba",
        summary: "Nem sikerült lekérdezni a Webshare RSS státuszt.",
        publishedAt: null,
        checkedAt: new Date().toISOString(),
      });
    }
  }, []);

  const loadPoints = useCallback(async () => {
    setPoints((current) => ({ ...current, loading: true, error: null }));

    try {
      const response = await fetch("/api/kicklet/points", { cache: "no-store" });
      const data = (await response.json()) as {
        found?: boolean;
        points?: number;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "Pontszám hiba");
      }

      setPoints({
        loading: false,
        found: Boolean(data.found),
        points: Number(data.points || 0),
        error: data.found ? null : data.error || "Nincs Kicklet pont rekord",
      });
    } catch (nextError) {
      setPoints({
        loading: false,
        found: false,
        points: 0,
        error: nextError instanceof Error ? nextError.message : "Pontszám hiba",
      });
    }
  }, []);

  const loadStatus = useCallback(async () => {
    const response = await fetch("/api/auth/status", { cache: "no-store" });
    const nextAuth = (await response.json()) as AuthStatus;
    setAuth(nextAuth);

    if (nextAuth.authenticated && nextAuth.userName) {
      await loadPoints();
    }
  }, [loadPoints]);

  const loadItems = useCallback(async (force = false) => {
    setLoadingItems(true);
    setError(null);

    try {
      const response = await fetch(`/api/items${force ? "?refresh=1" : ""}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as {
        items?: ShopItem[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "Item lista nem jött le");
      }

      const nextItems = data.items || [];
      setItems(nextItems);
      setSelectedItemId((current) => current || nextItems[0]?.id || "");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Item hiba");
    } finally {
      setLoadingItems(false);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    const response = await fetch("/api/redeem/jobs", { cache: "no-store" });

    if (!response.ok) return;

    const data = (await response.json()) as { jobs?: RedeemJob[] };
    const nextJobs = data.jobs || [];
    setJobs(nextJobs);

    const nextProxyStatus = nextJobs.find((nextJob) => nextJob.proxyStatus)?.proxyStatus;
    if (nextProxyStatus) {
      setProxyStatus(nextProxyStatus);
    }
  }, []);

  async function startRedeem() {
    if (!selectedItem) {
      return;
    }

    setStarting(true);
    setError(null);

    try {
      const response = await fetch("/api/redeem/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId: selectedItem.id,
          quantity,
          turnstileToken,
        }),
      });
      const data = (await response.json()) as {
        jobs?: RedeemJob[];
        job?: RedeemJob;
        error?: string;
      };

      const nextJob = data.job || data.jobs?.[0];

      if (!response.ok || !nextJob) {
        if (response.status === 401) {
          await loadStatus();
        }

        throw new Error(data.error || "Nem indult el");
      }

      setJobs((current) => [nextJob, ...current]);
      if (nextJob.proxyStatus) {
        setProxyStatus(nextJob.proxyStatus);
      }
      setTurnstileToken("");
      window.turnstile?.reset();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Indítási hiba");
      setTurnstileToken("");
      window.turnstile?.reset();
    } finally {
      setStarting(false);
    }
  }

  function requestStart() {
    void startRedeem();
  }

  async function cancelJob(id = "") {
    if (!id) {
      return;
    }

    setCancelingJobId(id);
    setError(null);

    try {
      const response = await fetch(`/api/redeem/jobs/${id}`, {
        method: "DELETE",
        cache: "no-store",
      });
      const data = (await response.json()) as {
        job?: RedeemJob;
        error?: string;
      };

      if (!response.ok || !data.job) {
        throw new Error(data.error || "Nem sikerült megszakítani");
      }

      setJobs((current) => current.filter((nextJob) => nextJob.id !== data.job?.id));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Megszakítási hiba");
    } finally {
      setCancelingJobId("");
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setJobs([]);
    setPoints({ loading: false, found: false, points: 0, error: null });
    await loadStatus();
  }

  function useMaxQuantity() {
    const nextQuantity = Math.max(1, Math.min(maxByPoints, auth?.maxQuantity || 100));
    setQuantity(nextQuantity);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStatus();
      void loadItems();
      void loadJobs();
      void loadProxyStatus();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadItems, loadJobs, loadProxyStatus, loadStatus]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadProxyStatus();
    }, 180_000);

    return () => window.clearInterval(timer);
  }, [loadProxyStatus]);

  useEffect(() => {
    if (!hasActiveJobs) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadJobs();
      void loadPoints();
    }, hasSlowActiveJob ? 10_000 : 900);

    return () => window.clearInterval(timer);
  }, [activeJobKey, hasActiveJobs, hasSlowActiveJob, loadJobs, loadPoints]);

  if (!auth) {
    return <AuthCheckingShell />;
  }

  if (!auth.authenticated) {
    return <AuthGate2 configured={auth.configured} loading={false} />;
  }

  return (
    <TooltipProvider>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setTurnstileReady(true)}
      />
      <main className="min-h-screen bg-background text-foreground">
        <section className="app-shell-enter mx-auto flex min-h-screen w-full max-w-[1700px] flex-col gap-3 px-3 py-3 sm:gap-4 sm:px-4 sm:py-4">
          <header className="flex items-center justify-between gap-3 pb-3 sm:items-end sm:pb-4">
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-normal sm:text-2xl">
                Kicklet Bulk Redeem
              </h1>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-md border border-input bg-input/30 px-2 py-1.5 font-mono text-xs text-muted-foreground sm:gap-2 sm:px-2.5">
                <Coins className="size-3.5 shrink-0" />
                {points.loading ? (
                  <Skeleton className="h-3.5 w-12" />
                ) : (
                  <span>{formatNumber(points.points)}</span>
                )}
              </span>
              {auth.userName ? (
                <span className="flex max-w-[34vw] items-center gap-1.5 rounded-md border border-input bg-input/30 px-2 py-1.5 font-mono text-xs text-muted-foreground sm:max-w-none sm:gap-2 sm:px-2.5">
                  <User className="size-3.5 shrink-0" />
                  <span className="truncate">@{auth.userName}</span>
                </span>
              ) : null}
              <Button variant="outline" onClick={() => void logout()} className="h-8 px-2.5">
                <LogOut className="size-4" />
                Kilépés
              </Button>
            </div>
          </header>

          {proxyStatus && !proxyStatus.ok ? (
            <div className="mt-3 rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-300" />
                <div className="min-w-0">
                  <div className="font-medium">Webshare proxy hiba: {proxyStatus.title}</div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-red-100/75">
                    {proxyStatus.summary || "A kiváltás proxy hiba miatt nem indul."}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,540px)_420px] lg:items-start lg:justify-center xl:grid-cols-[620px_420px] 2xl:grid-cols-[720px_420px]">
            <section className="rounded-lg border border-border/80 bg-card/70 p-3 shadow-none sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3 border-b border-border/70 pb-3 sm:mb-4 sm:pb-4">
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <ShoppingBag className="size-5" />
                  Redeem
                </h2>
              </div>
              <div className="space-y-3 sm:space-y-5">
                {auth?.configured === false ? (
                  <StatusLine
                    tone="error"
                    text="Hiányzik a KICK_CLIENT_ID vagy KICK_CLIENT_SECRET."
                  />
                ) : null}
                {error ? <StatusLine tone="error" text={error} /> : null}
                {auth?.authenticated && !auth.userName ? (
                  <Alert className="rounded-md border-border/80 bg-muted/20">
                    <AlertCircle className="size-4" />
                    <AlertDescription>
                      Régi token: authorizálj újra a pontszámhoz.
                    </AlertDescription>
                  </Alert>
                ) : null}

                {points.error ? (
                  <StatusLine tone="error" text={points.error} />
                ) : null}

                <div className="grid gap-2">
                  <div className="grid gap-2">
                  <Label>Item</Label>
                  <Select
                    value={selectedItemId}
                    onValueChange={setSelectedItemId}
                    disabled={loadingItems || items.length === 0}
                  >
                    <SelectTrigger
                      key={selectedItemId || "empty-item"}
                      className="item-select-motion h-12 w-full rounded-md"
                    >
                      <SelectValue
                        placeholder={
                          loadingItems ? "Itemek betöltése..." : "Válassz itemet"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent className="item-dropdown-motion">
                      {items.map((item, index) => (
                        <SelectItem
                          key={item.id}
                          value={item.id}
                          className="item-option-motion"
                          style={{ animationDelay: `${Math.min(index, 8) * 24}ms` }}
                        >
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  </div>

                  <div
                    key={selectedItemId || "empty-total"}
                    className="item-summary-motion grid grid-cols-2 gap-2"
                  >
                    <InfoTile
                      icon={<Coins className="size-4" />}
                      label="Összesen"
                      value={selectedPrice ? formatNumber(totalCost) : "-"}
                    />
                    <InfoTile
                      icon={<Clock3 className="size-4" />}
                      label="Becsült idő"
                      value={formatDuration(estimatedSeconds)}
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label>Darab</Label>
                  <QuantityControl
                    disabledMax={!selectedPrice || !points.points}
                    onChange={setQuantity}
                    onMax={useMaxQuantity}
                    value={quantity}
                  />
                </div>

                <TurnstileBox
                  onToken={setTurnstileToken}
                  scriptReady={turnstileReady}
                />

                <Button
                  className="redeem-start-motion h-12 w-full rounded-md text-base"
                  onClick={requestStart}
                  disabled={!canStart}
                >
                  {starting ? <Loader2 className="size-4 animate-spin" /> : null}
                  Start
                </Button>
              </div>
            </section>

            <section className="rounded-lg border border-border/80 bg-card/70 p-3 shadow-none sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3 border-b border-border/70 pb-3 sm:mb-4 sm:pb-4">
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <span className="flex items-center gap-2">
                    <Radio className="size-5" />
                    Job
                  </span>
                </h2>
                  <span className="rounded-md border border-input bg-input/30 px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    {activeJobs.length} aktív
                  </span>
              </div>
              <div className="space-y-5">
                {jobs.length ? (
                  <div className="grid gap-3">
                    {jobs.map((nextJob) => (
                      <JobCard
                        key={nextJob.id}
                        job={nextJob}
                        canceling={cancelingJobId === nextJob.id}
                        onCancel={cancelJob}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="grid min-h-[240px] place-items-center rounded-lg border border-dashed border-border/80 bg-muted/10 text-center text-muted-foreground">
                    <div>
                      <Radio className="mx-auto mb-3 size-8" />
                      <div>Nincs aktív job</div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </section>
      </main>
    </TooltipProvider>
  );
}

function JobCard({
  job,
  canceling,
  onCancel,
}: {
  job: RedeemJob;
  canceling: boolean;
  onCancel: (id: string) => void;
}) {
  const progress = ((job.sent + job.failed) / job.total) * 100;
  const canCancel = isActiveJob(job);
  const scheduleLabel =
    job.status === "scheduled"
      ? "Ütemezett indítás"
      : job.status === "proxy_wait"
        ? "Proxy újrapróba"
        : "Becsült teljes idő";
  const scheduleValue =
    (job.status === "scheduled" || job.status === "proxy_wait") && job.scheduledFor
      ? formatDateTime(job.scheduledFor)
      : formatDuration(job.estimatedSeconds);

  return (
    <div className="grid gap-3 rounded-md border border-border/80 bg-muted/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{job.itemName}</div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">
            {job.total} db · {statusLabels[job.status]}
          </div>
        </div>
        {canCancel ? (
          <Button
            variant="destructive"
            size="sm"
            className="shrink-0 rounded-md"
            onClick={() => onCancel(job.id)}
            disabled={canceling}
          >
            {canceling ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <X className="size-3.5" />
            )}
            Mégse
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="siker" value={job.sent} />
        <Metric label="hiba" value={job.failed} />
        <Metric label="küldve" value={job.attempted} />
        <Metric label="total" value={job.total} />
      </div>
      <Progress value={progress} />
      <InfoTile
        icon={<Clock3 className="size-4" />}
        label={scheduleLabel}
        value={scheduleValue}
      />
      <div className="max-h-[220px] overflow-hidden rounded-lg border border-border/80 bg-[#050505] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="flex items-center justify-between border-b border-border/70 bg-muted/10 px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">Log</span>
          <span className="font-mono text-xs text-muted-foreground">
            {job.logs.length} sor
          </span>
        </div>
        <div className="custom-scroll grid max-h-[178px] gap-1 overflow-y-auto p-2">
          {job.logs.length ? (
            job.logs.map((line, index) => (
              <JobLogLine key={`${job.id}-${index}-${line}`} line={line} index={index} />
            ))
          ) : (
            <div className="grid min-h-[120px] place-items-center text-sm text-muted-foreground">
              várakozik...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AuthCheckingShell() {
  return (
    <main className="auth-loading-screen min-h-screen bg-background text-foreground">
      <div className="loading-trace" aria-hidden="true" />
      <section className="app-shell-enter mx-auto flex min-h-screen w-full max-w-[1700px] flex-col gap-3 px-3 py-3 sm:gap-4 sm:px-4 sm:py-4">
        <header className="flex items-center justify-between gap-3 pb-3 sm:items-end sm:pb-4">
          <Skeleton className="h-7 w-56 max-w-[60vw]" />
          <Skeleton className="h-8 w-20" />
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,540px)_420px] lg:items-start lg:justify-center xl:grid-cols-[620px_420px] 2xl:grid-cols-[720px_420px]">
          <section className="rounded-lg border border-border/80 bg-card/70 p-3 shadow-none sm:p-5">
            <div className="mb-3 flex items-center justify-between border-b border-border/70 pb-3 sm:mb-4 sm:pb-4">
              <Skeleton className="h-6 w-28" />
            </div>
            <div className="space-y-3 sm:space-y-5">
              <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-20 rounded-md" />
                <Skeleton className="h-20 rounded-md" />
              </div>
              <Skeleton className="h-12 rounded-md" />
              <Skeleton className="h-11 rounded-md" />
              <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-20 rounded-md" />
                <Skeleton className="h-20 rounded-md" />
              </div>
              <Skeleton className="h-24 rounded-md" />
              <Skeleton className="h-12 rounded-md" />
            </div>
          </section>

          <section className="rounded-lg border border-border/80 bg-card/70 p-3 shadow-none sm:p-5">
            <div className="mb-3 flex items-center justify-between border-b border-border/70 pb-3 sm:mb-4 sm:pb-4">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-8 w-24" />
            </div>
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Skeleton className="h-20 rounded-md" />
                <Skeleton className="h-20 rounded-md" />
                <Skeleton className="h-20 rounded-md" />
                <Skeleton className="h-20 rounded-md" />
              </div>
              <Skeleton className="h-1 rounded-full" />
              <Skeleton className="h-20 rounded-md" />
              <Skeleton className="min-h-[280px] rounded-lg" />
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function AuthGate2({
  configured,
  loading,
}: {
  configured: boolean;
  loading: boolean;
}) {
  return (
    <main className="auth-loading-screen grid min-h-screen place-items-center bg-background px-4 py-10 text-foreground">
      <div className="loading-trace" aria-hidden="true" />
      <section className="auth-panel-enter w-full max-w-lg rounded-lg border border-border/80 bg-card/70 p-5 shadow-none sm:p-7">
        <div className="grid gap-4">
          <div className="auth-mark-motion grid size-12 place-items-center rounded-md border border-border bg-muted/20">
            <ShoppingBag className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-normal sm:text-4xl">
              Jelentkezz be Kickkel
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              Ez az oldal a kiválasztott Kicklet itemet tudja kiváltani a megadott mennyiségben. Ehhez Kick authorizáció kell, hogy lássa a Kick nevedet és az item kiváltásakor üzenetet tudjon küldeni a nevedben.
            </p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              Fontos: az oldal a nevedben semmit nem ír, csak az általad indított item kiváltás üzenetét.
            </p>
          </div>

          {loading ? (
            <Button disabled className="h-12 w-full rounded-md text-base">
              <Loader2 className="size-4 animate-spin" />
              Betöltés
            </Button>
          ) : configured ? (
            <Button asChild className="h-12 w-full rounded-md bg-[#00e701] text-base font-semibold text-black hover:bg-[#00d401]">
              <a href="/api/auth/kick/start">
                <KickIcon className="size-5" />
                Authorize with Kick
              </a>
            </Button>
          ) : (
            <Button disabled className="h-12 w-full rounded-md text-base">
              <AlertCircle className="size-4" />
              Kick auth nincs beállítva
            </Button>
          )}
        </div>
      </section>
    </main>
  );
}

function KickIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      fillRule="evenodd"
      clipRule="evenodd"
      strokeLinejoin="round"
      strokeMiterlimit={2}
      className={className}
      aria-hidden="true"
    >
      <path
        d="M37 .036h164.448v113.621h54.71v-56.82h54.731V.036h164.448v170.777h-54.73v56.82h-54.711v56.8h54.71v56.82h54.73V512.03H310.89v-56.82h-54.73v-56.8h-54.711v113.62H37V.036z"
        fill="currentColor"
      />
    </svg>
  );
}

function StatusLine({ tone, text }: { tone: "ok" | "error"; text: string }) {
  const Icon = tone === "ok" ? CheckCircle2 : AlertCircle;

  return (
    <div className="flex items-start gap-2 rounded-md border border-border/80 bg-muted/20 p-3 text-sm">
      <Icon className={tone === "ok" ? "mt-0.5 size-4" : "mt-0.5 size-4 text-red-300"} />
      <span>{text}</span>
    </div>
  );
}

function QuantityControl({
  disabledMax,
  onChange,
  onMax,
  value,
}: {
  disabledMax: boolean;
  onChange: (value: number | ((value: number) => number)) => void;
  onMax: () => void;
  value: number;
}) {
  function setInputValue(nextValue: string) {
    onChange(Math.max(1, Math.floor(Number(nextValue) || 1)));
  }

  return (
    <div className="group flex h-11 overflow-hidden rounded-lg border border-input bg-[#141414] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-colors focus-within:border-ring/60 hover:bg-[#171717]">
      <Button
        aria-label="Kevesebb"
        className="quantity-action-motion h-full w-11 rounded-none border-0 border-r border-input bg-transparent dark:bg-transparent hover:bg-muted/30 dark:hover:bg-muted/30"
        size="icon"
        variant="outline"
        onClick={() => onChange((current) => Math.max(1, current - 1))}
      >
        <Minus className="size-4" />
      </Button>
      <div className="relative min-w-0 flex-1 border-r border-input">
        <Input
          aria-label="Darab"
          className="[appearance:textfield] h-full rounded-none border-0 bg-transparent text-center font-mono text-base text-foreground shadow-none focus-visible:ring-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          inputMode="numeric"
          min={1}
          pattern="[0-9]*"
          type="text"
          value={value}
          onChange={(event) => setInputValue(event.target.value)}
        />
      </div>
      <Button
        aria-label="Több"
        className="quantity-action-motion h-full w-11 rounded-none border-0 border-r border-input bg-transparent dark:bg-transparent hover:bg-muted/30 dark:hover:bg-muted/30"
        size="icon"
        variant="outline"
        onClick={() => onChange((current) => current + 1)}
      >
        <Plus className="size-4" />
      </Button>
      <Button
        className="quantity-action-motion h-full w-[72px] rounded-none border-0 bg-transparent px-2 font-semibold dark:bg-transparent hover:bg-muted/30 dark:hover:bg-muted/30"
        disabled={disabledMax}
        variant="ghost"
        onClick={onMax}
      >
        Max
      </Button>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-input bg-input/30 p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-2xl">{value}</div>
    </div>
  );
}

function InfoTile({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-input bg-input/30 p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 break-words font-mono text-lg">{value}</div>
    </div>
  );
}

function JobLogLine({ line, index }: { line: string; index: number }) {
  const isProxyError = /proxy hiba|webshare proxy st[aá]tusz|full outage|degraded performance/iu.test(line);
  const isSuccess = /sikeres|kiv[aá]ltva sikeresen|k[eé]sz:/iu.test(line);
  const match = line.match(/^\[([^\]]+)\]\s*(.*)$/u);
  const time = match?.[1] || "";
  const message = match?.[2] || line;

  return (
    <div
      className={cn(
        "log-line-motion grid gap-1 rounded-md border px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3",
        isProxyError
          ? "border-red-400/25 bg-red-500/10 text-red-100"
          : isSuccess
            ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
            : "border-transparent bg-white/[0.035] text-muted-foreground",
      )}
      style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
    >
      <span className="min-w-0 break-words leading-5">{message}</span>
      <span className="flex items-center gap-2 text-xs text-muted-foreground sm:justify-end">
        <span className="rounded-md border border-input bg-background/60 px-2 py-1 font-medium">
          {isProxyError ? "proxy" : isSuccess ? "siker" : "log"}
        </span>
        {time ? <span>{time}</span> : <span>#{index + 1}</span>}
      </span>
    </div>
  );
}

function TurnstileBox({
  onToken,
  scriptReady,
}: {
  onToken: (token: string) => void;
  scriptReady: boolean;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const activeSiteKey =
    typeof window !== "undefined" && isLocalTurnstileHost(window.location.hostname)
      ? turnstileLocalSiteKey
      : turnstileSiteKey;

  useEffect(() => {
    if (!activeSiteKey) {
      return;
    }

    if (!scriptReady || !container || widgetIdRef.current || !window.turnstile) {
      return;
    }

    const id = window.turnstile.render(container, {
      sitekey: activeSiteKey,
      theme: "dark",
      callback: (token) => {
        setError(null);
        onToken(token);
      },
      "expired-callback": () => {
        onToken("");
      },
      "error-callback": () => {
        onToken("");
        setError("Turnstile ellenőrzés hiba");
      },
    });

    widgetIdRef.current = id;

    return () => {
      window.turnstile?.remove(id);
      widgetIdRef.current = null;
    };
  }, [activeSiteKey, container, onToken, scriptReady]);

  return (
    <div className="grid gap-2">
      <div className="text-sm text-muted-foreground">
        Cloudflare ellenőrzés
      </div>
      <div ref={setContainer} className="min-h-[65px]" />
      {!activeSiteKey ? (
        <div className="mt-2 text-xs text-red-300">
          Turnstile site key hiányzik
        </div>
      ) : null}
      {error ? <div className="mt-2 text-xs text-red-300">{error}</div> : null}
    </div>
  );
}

function isLocalTurnstileHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("hu-HU").format(Math.max(0, Math.floor(value)));
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;

  if (minutes < 1) {
    return `${rest} mp`;
  }

  return `${minutes}p ${rest.toString().padStart(2, "0")}mp`;
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("hu-HU", {
    timeZone: "Europe/Budapest",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
