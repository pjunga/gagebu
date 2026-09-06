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
import ThemeToggle from "./theme-toggle";
import {
  allowedGoogleEmails,
  auth,
  isAllowedFirebaseUser,
  isFirebaseConfigured,
} from "@/lib/firebase";

// Dev-only escape hatch: skips the Google gate so the dashboard can be opened
// without Firebase credentials. Never true in a production build.
const devAuthBypass =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "1";

type AuthState =
  | { status: "loading" }
  | { status: "signed-out"; message?: string }
  | { status: "allowed"; user: User };

const AuthenticatedUserContext = createContext<User | null>(null);

export function AuthAccountControls() {
  const user = useContext(AuthenticatedUserContext);

  if (!user) return null;

  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2 rounded-2xl border border-line bg-card px-2.5 py-1.5 text-xs text-body backdrop-blur">
      <span className="hidden max-w-40 truncate 2xl:inline">{user.email}</span>
      <button
        type="button"
        onClick={() => auth && void signOut(auth)}
        className="shrink-0 rounded-xl border border-line px-2.5 py-1.5 text-body transition hover:border-line-strong hover:bg-hover"
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
    isFirebaseConfigured && auth && allowedGoogleEmails.length
      ? { status: "loading" }
      : { status: "signed-out" },
  );
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth || !allowedGoogleEmails.length) {
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

  if (devAuthBypass) {
    return <>{children}</>;
  }

  if (state.status === "allowed") {
    return (
      <AuthenticatedUserContext.Provider value={state.user}>
        {children}
      </AuthenticatedUserContext.Provider>
    );
  }

  const missingFirebase = !isFirebaseConfigured;
  const missingAllowlist = !allowedGoogleEmails.length;

  return (
    <main className="app-glow relative flex min-h-screen items-center justify-center bg-app px-5 text-ink">
      <section className="pop-in relative z-10 w-full max-w-md rounded-3xl border border-line bg-card p-8 shadow-2xl shadow-black/10 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
            Private access
          </p>
          <ThemeToggle />
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">내 가계부 ✿</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          등록된 Google 계정으로 로그인해야 가계부를 열 수 있습니다.
        </p>

        {state.status === "loading" ? (
          <div className="mt-8 h-12 animate-pulse rounded-2xl bg-hover" />
        ) : (
          <button
            type="button"
            disabled={signingIn || missingFirebase || missingAllowlist}
            onClick={() => void handleGoogleSignIn()}
            className="mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-2xl bg-[#ffffff] px-4 text-sm font-semibold text-[#1f2937] shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:bg-[#f4f4f5] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden="true" className="text-lg font-bold text-blue-600">G</span>
            {signingIn ? "로그인 중..." : "Google 계정으로 로그인"}
          </button>
        )}

        {(missingFirebase || missingAllowlist) && (
          <p className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-3 py-2.5 text-xs leading-5 text-amber-200">
            {missingFirebase
              ? "Firebase 환경변수 설정이 필요합니다."
              : "허용할 Google 이메일 환경변수 설정이 필요합니다."}
          </p>
        )}
        {state.status === "signed-out" && state.message && (
          <p role="alert" className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-3 py-2.5 text-xs leading-5 text-rose-200">
            {state.message}
          </p>
        )}
      </section>
    </main>
  );
}
