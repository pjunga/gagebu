"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getRedirectResult,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from "firebase/auth";
import {
  allowedGoogleEmail,
  auth,
  isAllowedFirebaseUser,
  isFirebaseConfigured,
} from "@/lib/firebase";

type AuthState =
  | { status: "loading" }
  | { status: "signed-out"; message?: string }
  | { status: "allowed"; user: User };

const AuthenticatedUserContext = createContext<User | null>(null);

export function AuthAccountControls() {
  const user = useContext(AuthenticatedUserContext);

  if (!user) return null;

  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-slate-950/85 px-2.5 py-1.5 text-xs text-slate-300 shadow-xl backdrop-blur">
      <span className="hidden max-w-40 truncate 2xl:inline">{user.email}</span>
      <button
        type="button"
        onClick={() => auth && void signOut(auth)}
        className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1.5 text-slate-200 transition hover:border-white/20 hover:bg-white/10"
      >
        로그아웃
      </button>
    </div>
  );
}

function friendlyAuthError(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (code === "auth/popup-closed-by-user") return "로그인 창이 닫혔습니다.";
  if (code === "auth/popup-blocked") return "브라우저에서 로그인 팝업을 허용해주세요.";
  if (code === "auth/cancelled-popup-request") return "진행 중인 로그인 창을 확인해주세요.";
  if (code === "auth/unauthorized-domain") return "현재 주소를 Firebase 승인 도메인에 추가해주세요.";
  return "Google 로그인에 실패했습니다. 잠시 후 다시 시도해주세요.";
}

function authErrorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "";
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() =>
    isFirebaseConfigured && auth && allowedGoogleEmail
      ? { status: "loading" }
      : { status: "signed-out" },
  );
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth || !allowedGoogleEmail) {
      return;
    }

    const firebaseAuth = auth;
    let active = true;

    const applyUser = (user: User | null) => {
      if (!active) return;
      if (isAllowedFirebaseUser(user)) {
        setState({ status: "allowed", user: user as User });
        return;
      }
      if (user) {
        void signOut(firebaseAuth).finally(() => {
          if (!active) return;
          setState({
            status: "signed-out",
            message: "이 Google 계정은 접근 권한이 없습니다.",
          });
        });
        return;
      }
      setState({ status: "signed-out" });
    };

    const unsubscribe = onAuthStateChanged(firebaseAuth, applyUser);
    void (async () => {
      try {
        await setPersistence(firebaseAuth, browserLocalPersistence);
        const redirectResult = await getRedirectResult(firebaseAuth);
        if (redirectResult) applyUser(redirectResult.user);
      } catch (error) {
        if (!active) return;
        setState({
          status: "signed-out",
          message: friendlyAuthError(error),
        });
      }
    })();

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const handleGoogleSignIn = async () => {
    if (!auth) return;
    setSigningIn(true);
    setState({ status: "signed-out" });
    try {
      await setPersistence(auth, browserLocalPersistence);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      try {
        const result = await signInWithPopup(auth, provider);
        if (isAllowedFirebaseUser(result.user)) {
          setState({ status: "allowed", user: result.user });
          return;
        }
        await signOut(auth);
        setState({
          status: "signed-out",
          message: "이 Google 계정은 접근 권한이 없습니다.",
        });
      } catch (error) {
        if (authErrorCode(error) === "auth/popup-blocked") {
          await signInWithRedirect(auth, provider);
          return;
        }
        throw error;
      }
    } catch (error) {
      setState({ status: "signed-out", message: friendlyAuthError(error) });
    } finally {
      setSigningIn(false);
    }
  };

  if (state.status === "allowed") {
    return (
      <AuthenticatedUserContext.Provider value={state.user}>
        {children}
      </AuthenticatedUserContext.Provider>
    );
  }

  const missingFirebase = !isFirebaseConfigured;
  const missingAllowlist = !allowedGoogleEmail;

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-5 text-slate-50">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.055] p-8 shadow-2xl shadow-black/30 backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
          Private access
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">내 가계부</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          등록된 Google 계정으로 로그인해야 가계부를 열 수 있습니다.
        </p>

        {state.status === "loading" ? (
          <div className="mt-8 h-12 animate-pulse rounded-xl bg-white/10" />
        ) : (
          <button
            type="button"
            disabled={signingIn || missingFirebase || missingAllowlist}
            onClick={() => void handleGoogleSignIn()}
            className="mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-white px-4 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden="true" className="text-lg font-bold text-blue-600">G</span>
            {signingIn ? "로그인 중..." : "Google 계정으로 로그인"}
          </button>
        )}

        {(missingFirebase || missingAllowlist) && (
          <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2.5 text-xs leading-5 text-amber-200">
            {missingFirebase
              ? "Firebase 환경변수 설정이 필요합니다."
              : "허용할 Google 이메일 환경변수 설정이 필요합니다."}
          </p>
        )}
        {state.status === "signed-out" && state.message && (
          <p role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2.5 text-xs leading-5 text-rose-200">
            {state.message}
          </p>
        )}
      </section>
    </main>
  );
}
