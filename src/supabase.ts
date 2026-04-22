const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://supabase-kong:8000';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface SupabaseOptions {
  prefer?: string;
  body?: unknown;
}

export async function supaFetch<T = unknown>(
  method: Method,
  path: string,
  opts: SupabaseOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Accept: 'application/json',
  };
  if (opts.body) headers['Content-Type'] = 'application/json';
  if (opts.prefer) headers['Prefer'] = opts.prefer;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${method} ${path} → ${res.status}: ${text}`);
  }

  const text = await res.text();
  return text ? (JSON.parse(text) as T) : ([] as unknown as T);
}

export async function supaRpc<T = unknown>(fn: string, params: unknown): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase RPC ${fn} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}
