const TOKEN_KEY = "cf_token";
const NAME_KEY = "cf_username";

export interface StoredSession {
  token: string;
  username: string;
}

export function loadSession(): StoredSession | null {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  return { token, username: localStorage.getItem(NAME_KEY) ?? "" };
}

export function saveSession(s: StoredSession): void {
  localStorage.setItem(TOKEN_KEY, s.token);
  localStorage.setItem(NAME_KEY, s.username);
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(NAME_KEY);
}

/**
 * Sunucudaki oturumu iptal eder. Hata olsa bile yerel oturum çağıranda silinir;
 * bu yüzden burada hiçbir şey fırlatılmaz.
 */
export async function logoutRequest(token: string, all: boolean): Promise<void> {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(all ? { all: true } : {}),
    });
  } catch {
    // Ağ hatası: yerel oturum yine de silinir.
  }
}
