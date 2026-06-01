function getBackendUrl() {
  return (process.env.BACKEND_URL || "http://localhost:3117").replace(/\/$/, "");
}

function getBackendSecret() {
  const secret = process.env.BACKEND_INTERNAL_SECRET || "";

  if (!secret) {
    throw new Error("BACKEND_INTERNAL_SECRET is not configured");
  }

  return secret;
}

export async function backendRequest<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${getBackendUrl()}${path}`, {
    ...init,
    headers: {
      "x-backend-secret": getBackendSecret(),
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  const data = (await response.json().catch(() => null)) as T & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(data?.error || `Backend request failed (${response.status})`);
  }

  return data;
}
