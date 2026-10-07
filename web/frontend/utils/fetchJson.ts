/** fetch JSON; lỗi HTTP ném Error với thông báo `error` mà backend trả về. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}
