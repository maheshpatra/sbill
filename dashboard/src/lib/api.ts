export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const base = (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4317").replace(/\/$/, "");
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as { message?: string | string[] };
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join(" ") : body.message || response.statusText;
    throw new ApiError(response.status, message);
  }
  return body as T;
}

export async function authed<T>(path: string, init?: RequestInit): Promise<T> {
  const { getSupabase } = await import("./supabase");
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError(401, "Sign in again.");
  return api<T>(path, token, init);
}
