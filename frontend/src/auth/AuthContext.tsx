import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";

import { storage } from "@/src/utils/storage";
import { AuthUser, fetchMe, postEmailLogin, postEmailRegister, postLogout, postSession } from "@/src/game/api";

const TOKEN_KEY = "tycoon_session_token";
const DEVICE_KEY = "tycoon_device_id";
// Google sign-in. Defaults to Emergent-managed Google Auth so the button works
// out of the box. To use YOUR OWN hosted OAuth page instead, set
// GOOGLE_AUTH_BASE in backend/api_keys.py (it flows to frontend/.env as
// EXPO_PUBLIC_GOOGLE_AUTH_BASE) and GOOGLE_AUTH_SESSION_API on the backend.
const AUTH_BASE = process.env.EXPO_PUBLIC_GOOGLE_AUTH_BASE || "https://auth.emergentagent.com/";
const GOOGLE_AUTH_ENABLED = AUTH_BASE.length > 0;

type AuthState = {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  googleAuthEnabled: boolean;
  loginWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, name: string, referralCode?: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function parseSessionId(url: string): string | null {
  if (!url) return null;
  const m = url.match(/[#?&]session_id=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const processing = useRef(false);

  const processSessionId = useCallback(async (sessionId: string) => {
    if (processing.current) return;
    processing.current = true;
    try {
      const deviceId = (await storage.getItem(DEVICE_KEY, "")) ?? "";
      const { session_token, user: u } = await postSession(sessionId, String(deviceId));
      await storage.secureSet(TOKEN_KEY, session_token);
      setToken(session_token);
      setUser(u);
    } catch {
      // ignore — leave unauthenticated
    } finally {
      processing.current = false;
    }
  }, []);

  // On mount: process redirect (web) or restore existing session.
  useEffect(() => {
    (async () => {
      // Web: a session_id may be in the URL after returning from Google.
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const sid = parseSessionId(window.location.hash) || parseSessionId(window.location.search);
        if (sid) {
          await processSessionId(sid);
          window.history.replaceState(null, "", window.location.pathname);
          setLoading(false);
          return;
        }
      } else {
        // Mobile cold-start deep link fallback.
        const initial = await Linking.getInitialURL();
        const sid = initial ? parseSessionId(initial) : null;
        if (sid) {
          await processSessionId(sid);
          setLoading(false);
          return;
        }
      }
      // Restore stored token.
      const stored = (await storage.secureGet(TOKEN_KEY, "")) ?? "";
      if (stored) {
        try {
          const me = await fetchMe(String(stored));
          setToken(String(stored));
          setUser(me);
        } catch {
          await storage.secureRemove(TOKEN_KEY);
        }
      }
      setLoading(false);
    })();
  }, [processSessionId]);

  // Mobile: listen for hot deep links carrying a session_id.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = Linking.addEventListener("url", ({ url }) => {
      const sid = parseSessionId(url);
      if (sid) processSessionId(sid);
    });
    return () => sub.remove();
  }, [processSessionId]);

  const loginWithGoogle = useCallback(async () => {
    if (!GOOGLE_AUTH_ENABLED) return;
    const redirectUrl =
      Platform.OS === "web" && typeof window !== "undefined"
        ? window.location.origin + "/"
        : Linking.createURL("auth");
    const authUrl = `${AUTH_BASE}?redirect=${encodeURIComponent(redirectUrl)}`;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.href = authUrl;
      return;
    }
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    if (result.type === "success" && result.url) {
      const sid = parseSessionId(result.url);
      if (sid) await processSessionId(sid);
    }
  }, [processSessionId]);

  const signUpWithEmail = useCallback(async (email: string, password: string, name: string, referralCode?: string) => {
    const deviceId = (await storage.getItem(DEVICE_KEY, "")) ?? "";
    const { session_token, user: u } = await postEmailRegister({
      email,
      password,
      name,
      referral_code: referralCode || undefined,
      device_id: String(deviceId) || undefined,
    });
    await storage.secureSet(TOKEN_KEY, session_token);
    setToken(session_token);
    setUser(u);
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const deviceId = (await storage.getItem(DEVICE_KEY, "")) ?? "";
    const { session_token, user: u } = await postEmailLogin({
      email,
      password,
      device_id: String(deviceId) || undefined,
    });
    await storage.secureSet(TOKEN_KEY, session_token);
    setToken(session_token);
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    if (token) {
      try {
        await postLogout(token);
      } catch {
        // ignore
      }
    }
    await storage.secureRemove(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, [token]);

  return (
    <AuthContext.Provider value={{ user, token, loading, googleAuthEnabled: GOOGLE_AUTH_ENABLED, loginWithGoogle, signInWithEmail, signUpWithEmail, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
