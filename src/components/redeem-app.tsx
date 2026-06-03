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
  LogIn,
  LogOut,
  Minus,
  Play,
  Plus,
  Radio,
  ShoppingBag,
  User,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Separator } from "@/components/ui/separator";
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
  status: "scheduled" | "proxy_wait" | "queued" | "running" | "done" | "failed";
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
};

const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";
const turnstileLocalSiteKey = "1x00000000000000000000AA";

export function RedeemApp() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [items, setItems] = useState<ShopItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [job, setJob] = useState<RedeemJob | null>(null);
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus | null>(null);
  const [loadedLatestJob, setLoadedLatestJob] = useState(false);
  const [loadingItems, setLoadingItems] = useState(true);
  const [starting, setStarting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
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
  const progress = job ? ((job.sent + job.failed) / job.total) * 100 : 0;
  const selectedPrice = Math.max(0, Number(selectedItem?.price || 0));
  const estimatedSeconds =
    quantity * Math.max(1, Math.round((auth?.redeemDelayMs || 5000) / 1000));
  const totalCost = selectedPrice * quantity;
  const maxByPoints =
    selectedPrice > 0 ? Math.floor(points.points / selectedPrice) : 0;
  const canStart =
    Boolean(auth?.authenticated && selectedItem && quantity > 0 && turnstileToken) &&
    !starting;

  const showVodWarning = isHungaryVodRiskWindow();

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
        job?: RedeemJob;
        error?: string;
      };

      if (!response.ok || !data.job) {
        throw new Error(data.error || "Nem indult el");
      }

      setJob(data.job);
      setLoadedLatestJob(true);
      if (data.job.proxyStatus) {
        setProxyStatus(data.job.proxyStatus);
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
    if (showVodWarning) {
      setConfirmOpen(true);
      return;
    }

    void startRedeem();
  }

  function confirmStart() {
    setConfirmOpen(false);
    void startRedeem();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setJob(null);
    setLoadedLatestJob(false);
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
      void loadProxyStatus();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadItems, loadProxyStatus, loadStatus]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadProxyStatus();
    }, 180_000);

    return () => window.clearInterval(timer);
  }, [loadProxyStatus]);

  useEffect(() => {
    if (
      !job ||
      (job.status !== "scheduled" &&
        job.status !== "proxy_wait" &&
        job.status !== "queued" &&
        job.status !== "running")
    ) {
      return;
    }

    const pollMs =
      job.status === "scheduled" || job.status === "proxy_wait" ? 10_000 : 900;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/redeem/jobs/${job.id}`, {
        cache: "no-store",
      });

      if (response.ok) {
        const data = (await response.json()) as { job: RedeemJob };
        setJob(data.job);
        if (data.job.status === "done" || data.job.status === "failed") {
          void loadPoints();
        }
      }
    }, pollMs);

    return () => window.clearInterval(timer);
  }, [job, loadPoints]);

  useEffect(() => {
    if (!auth?.authenticated || loadedLatestJob || job) {
      return;
    }

    setLoadedLatestJob(true);
    void (async () => {
      const response = await fetch("/api/redeem/jobs/latest", {
        cache: "no-store",
      });

      if (!response.ok) return;

      const data = (await response.json()) as { job?: RedeemJob | null };
      if (data.job) {
        setJob(data.job);
        if (data.job.proxyStatus) {
          setProxyStatus(data.job.proxyStatus);
        }
      }
    })();
  }, [auth?.authenticated, job, loadedLatestJob]);

  if (!auth) {
    return <AuthGate2 configured={true} loading />;
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
      <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.075),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.045),transparent_30%),linear-gradient(180deg,rgba(0,0,0,0.04),rgba(0,0,0,0.82))]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:64px_64px] opacity-35" />

        <section className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-3 py-3 sm:px-6 sm:py-5 lg:px-8">
          <header className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-center sm:justify-between sm:pb-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="rounded-md">
                  eazykeee chat
                </Badge>
                <Badge
                  variant={proxyStatus?.ok ? "default" : "destructive"}
                  className="rounded-md"
                >
                  {proxyStatus?.ok ? "proxy rendben" : "proxy hiba"}
                </Badge>
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-normal text-balance sm:text-5xl">
                Kicklet Bulk Redeem
              </h1>
            </div>

            <div className="flex shrink-0 items-center">
              <Button variant="outline" onClick={() => void logout()} className="w-full sm:w-auto">
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

          <div className="grid flex-1 gap-3 py-3 sm:gap-4 sm:py-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
            <Card className="rounded-lg border-white/10 bg-black/50 shadow-none backdrop-blur">
              <CardHeader className="pb-3 sm:pb-6">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <ShoppingBag className="size-5" />
                  Redeem
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 sm:space-y-5">
                {auth?.configured === false ? (
                  <StatusLine
                    tone="error"
                    text="Hiányzik a KICK_CLIENT_ID vagy KICK_CLIENT_SECRET."
                  />
                ) : null}
                {error ? <StatusLine tone="error" text={error} /> : null}
                {auth?.authenticated && !auth.userName ? (
                  <Alert className="rounded-md border-white/10 bg-white/[0.04]">
                    <AlertCircle className="size-4" />
                    <AlertDescription>
                      Régi token: authorizálj újra a pontszámhoz.
                    </AlertDescription>
                  </Alert>
                ) : null}

                <div className="grid gap-2 sm:grid-cols-2">
                  <InfoTile
                    icon={<User className="size-4" />}
                    label="Kick user"
                    value={auth?.userName ? `@${auth.userName}` : "-"}
                  />
                  <div className="rounded-md border border-white/10 bg-white/[0.04] p-3">
                    <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
                      <Coins className="size-4" />
                      Pontszám
                    </div>
                    {points.loading ? (
                      <Skeleton className="mt-2 h-7 w-24" />
                    ) : (
                      <div className="mt-1 font-mono text-2xl">
                        {formatNumber(points.points)}
                      </div>
                    )}
                    {points.error ? (
                      <div className="mt-1 text-xs text-red-300">{points.error}</div>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label>Item</Label>
                  <Select
                    value={selectedItemId}
                    onValueChange={setSelectedItemId}
                    disabled={loadingItems || items.length === 0}
                  >
                    <SelectTrigger className="h-12 rounded-md">
                      <SelectValue
                        placeholder={
                          loadingItems ? "Itemek betöltése..." : "Válassz itemet"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {items.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>Darab</Label>
                  <div className="grid grid-cols-[44px_minmax(0,1fr)_44px_64px] gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                    >
                      <Minus className="size-4" />
                    </Button>
                    <Input
                      className="h-11 rounded-md text-center font-mono text-base"
                      inputMode="numeric"
                      min={1}
                      type="number"
                      value={quantity}
                      onChange={(event) =>
                        setQuantity(
                          Math.max(1, Math.floor(Number(event.target.value) || 1)),
                        )
                      }
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setQuantity((value) => value + 1)}
                    >
                      <Plus className="size-4" />
                    </Button>
                    <Button
                      variant="secondary"
                      className="rounded-md px-2"
                      onClick={useMaxQuantity}
                      disabled={!selectedPrice || !points.points}
                    >
                      Max
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <InfoTile
                    icon={<Coins className="size-4" />}
                    label="Ár / összesen"
                    value={
                      selectedPrice
                        ? `${formatNumber(selectedPrice)} / ${formatNumber(totalCost)}`
                        : "-"
                    }
                  />
                  <InfoTile
                    icon={<Clock3 className="size-4" />}
                    label="Becsült idő"
                    value={formatDuration(estimatedSeconds)}
                  />
                </div>

                <TurnstileBox
                  onToken={setTurnstileToken}
                  scriptReady={turnstileReady}
                />

                <Button
                  className="h-12 w-full rounded-md text-base"
                  onClick={requestStart}
                  disabled={!canStart}
                >
                  {starting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Play className="size-4" />
                  )}
                  Start
                </Button>
              </CardContent>
            </Card>

            <Card className="rounded-lg border-white/10 bg-black/50 shadow-none backdrop-blur">
              <CardHeader className="pb-3 sm:pb-6">
                <CardTitle className="flex items-center justify-between gap-2 text-xl">
                  <span className="flex items-center gap-2">
                    <Radio className="size-5" />
                    Job
                  </span>
                  {job ? (
                    <Badge variant="outline" className="rounded-md">
                      {statusLabels[job.status]}
                    </Badge>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {job ? (
                  <>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Metric label="siker" value={job.sent} />
                      <Metric label="hiba" value={job.failed} />
                      <Metric label="küldve" value={job.attempted} />
                      <Metric label="total" value={job.total} />
                    </div>
                    <Progress value={progress} />
                    <InfoTile
                      icon={<Clock3 className="size-4" />}
                      label={
                        job.status === "scheduled"
                          ? "Ütemezett indítás"
                          : job.status === "proxy_wait"
                            ? "Proxy újrapróba"
                            : "Becsült teljes idő"
                      }
                      value={
                        (job.status === "scheduled" || job.status === "proxy_wait") && job.scheduledFor
                          ? formatDateTime(job.scheduledFor)
                          : formatDuration(job.estimatedSeconds)
                      }
                    />
                    <Separator />
                    <div className="max-h-[45vh] min-h-[220px] overflow-hidden rounded-lg border border-white/10 bg-black/40 p-2 sm:min-h-[260px]">
                      <div className="custom-scroll grid max-h-[calc(45vh-16px)] gap-2 overflow-y-auto pr-1">
                      {job.logs.length ? (
                        job.logs.map((line, index) => (
                          <JobLogLine
                            key={`${index}-${line}`}
                            line={line}
                            index={index}
                          />
                        ))
                      ) : (
                        <div className="p-8 text-center text-sm text-muted-foreground">
                          várakozik...
                        </div>
                      )}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="grid min-h-[360px] place-items-center rounded-lg border border-dashed border-white/15 bg-white/[0.02] text-center text-muted-foreground">
                    <div>
                      <Radio className="mx-auto mb-3 size-8" />
                      <div>Nincs aktív job</div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </section>

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent className="rounded-lg border-white/10 bg-zinc-950 text-foreground sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Biztosan most akarsz kiváltani?</DialogTitle>
              <DialogDescription>
                Magyar idő szerint 10:00 és 02:00 között vagyunk. Lehet, hogy
                épp nem VOD megy, ezért a chat üzenetek élő adásba kerülhetnek.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border border-white/10 bg-white/[0.04] p-3 text-sm text-muted-foreground">
              {quantity} x {selectedItem?.name || "item"} - becsült idő{" "}
              {formatDuration(estimatedSeconds)}
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={() => setConfirmOpen(false)}
                className="w-full sm:w-auto"
              >
                Mégse
              </Button>
              <Button
                onClick={confirmStart}
                disabled={!canStart}
                className="w-full sm:w-auto"
              >
                Igen, indítsd
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </TooltipProvider>
  );
}

function AuthGate({
  configured,
  loading,
}: {
  configured: boolean;
  loading: boolean;
}) {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-4 py-10 text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.075),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.045),transparent_30%),linear-gradient(180deg,rgba(0,0,0,0.04),rgba(0,0,0,0.82))]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:64px_64px] opacity-35" />

      <section className="relative z-10 w-full max-w-xl rounded-lg border border-white/10 bg-black/55 p-5 shadow-none backdrop-blur sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="rounded-md">
            Kicklet Bulk Redeem
          </Badge>
          <Badge variant="outline" className="rounded-md">
            Kick auth szukseges
          </Badge>
        </div>

        <div className="mt-6 grid gap-4">
          <div className="grid size-12 place-items-center rounded-md border border-white/10 bg-white/[0.04]">
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
              Betoltes
            </Button>
          ) : configured ? (
            <Button asChild className="h-12 w-full rounded-md text-base">
              <a href="/api/auth/kick/start">
                <LogIn className="size-4" />
                Kick login
              </a>
            </Button>
          ) : (
            <Button disabled className="h-12 w-full rounded-md text-base">
              <AlertCircle className="size-4" />
              Kick auth nincs beallitva
            </Button>
          )}
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
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-4 py-10 text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.075),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.045),transparent_30%),linear-gradient(180deg,rgba(0,0,0,0.04),rgba(0,0,0,0.82))]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:64px_64px] opacity-35" />

      <section className="relative z-10 w-full max-w-xl rounded-lg border border-white/10 bg-black/55 p-5 shadow-none backdrop-blur sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="rounded-md">
            Kicklet Bulk Redeem
          </Badge>
          <Badge variant="outline" className="rounded-md">
            Kick auth szükséges
          </Badge>
        </div>

        <div className="mt-6 grid gap-4">
          <div className="grid size-12 place-items-center rounded-md border border-white/10 bg-white/[0.04]">
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
    <div className="flex items-start gap-2 rounded-md border border-white/10 bg-white/[0.04] p-3 text-sm">
      <Icon className={tone === "ok" ? "mt-0.5 size-4" : "mt-0.5 size-4 text-red-300"} />
      <span>{text}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.04] p-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
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
    <div className="rounded-md border border-white/10 bg-white/[0.04] p-3">
      <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
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
        "grid gap-1 rounded-md border px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3",
        isProxyError
          ? "border-red-400/25 bg-red-500/10 text-red-100"
          : isSuccess
            ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
            : "border-white/10 bg-white/[0.04] text-muted-foreground",
      )}
    >
      <span className="min-w-0 break-words leading-5">{message}</span>
      <span className="flex items-center gap-2 text-xs text-muted-foreground sm:justify-end">
        <span className="rounded-md border border-white/10 bg-black/25 px-2 py-1 uppercase">
          {isProxyError ? "proxy" : isSuccess ? "siker" : "naplo"}
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
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 text-sm text-muted-foreground">
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

function isHungaryVodRiskWindow() {
  const parts = new Intl.DateTimeFormat("hu-HU", {
    timeZone: "Europe/Budapest",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value);

  if (!Number.isFinite(hour)) {
    return false;
  }

  return hour >= 10 || hour < 2;
}
