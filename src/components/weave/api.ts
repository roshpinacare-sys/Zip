// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Frontend API layer — fetch יחסי בלבד, שגיאות בעברית
// כל התשובות מהשרת: { ok: true, ... } או { ok: false, error }
// ─────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      cache: "no-store",
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError("לא ניתן להתחבר לשרת — בדוק את החיבור ונסה שוב", 0);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const body = payload as { ok?: boolean; error?: string } | null;
  if (!response.ok || !body || body.ok !== true) {
    throw new ApiError(body?.error ?? `שגיאת שרת (${response.status})`, response.status);
  }
  return payload as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return "אירעה שגיאה לא צפויה";
}
