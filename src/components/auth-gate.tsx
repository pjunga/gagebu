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
  auth,
  isFirebaseConfigured,
  isGoogleFirebaseUser,
  probeFirestoreAccess,
} from "@/lib/firebase";

// Dev-only escape hatch: skips the Google gate so the dashboard can be opened
// without Firebase credentials. Never true in a production build.
const devAuthBypass =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "1";

type AuthState =
  | { status: "loading" }
  | { status: "checking" }
  | { status: "signed-out"; message?: string }
  | { status: "allowed"; user: User };

const NO_ACCESS_MESSAGE = "이 Google 계정은 접근 권한이 없습니다.";

const AuthenticatedUserContext = createContext<User | null>(null);

export function AuthAccountControls() {
  const user = useContext(AuthenticatedUserContext);

  if (!user) return null;

  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2 rounded-2xl border border-line bg-card px-2.5 py-0 text-xs text-body backdrop-blur lg:py-1.5">
      <span className="hidden max-w-40 truncate 2xl:inline">{user.email}</span>
      <button
        type="button"
        onClick={() => auth && void signOut(auth)}
        className="min-h-11 shrink-0 rounded-xl border border-line px-2.5 py-1.5 text-body transition hover:border-line-strong hover:bg-hover lg:min-h-0"
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
    isFirebaseConfigured && auth ? { status: "loading" } : { status: "signed-out" },
  );
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      return;
    }

    const firebaseAuth = auth;
    let active = true;
    // Both the listener and getRedirectResult report the same sign-in, and an
    // account can be swapped while a probe is still in flight. Each call takes
    // a ticket so a late answer cannot overwrite a newer one, and an account
    // already decided is not probed a second time.
    let ticket = 0;
    let probedUid: string | null = null;
    // Whether a signed-in account has taken over the screen. The redirect
    // handler below reports its own failure only while nothing has.
    let handlingUser = false;

    // Firestore, not a bundled list, decides who gets in. The probe runs after
    // sign-in because the rules answer for an authenticated caller only.
    const applyUser = async (user: User | null) => {
      if (!active) return;
      if (!isGoogleFirebaseUser(user)) {
        ticket += 1;
        probedUid = null;
        handlingUser = false;
        // Signing a refused account out fires this listener again, and a
        // failed redirect can land either side of it. Whoever put a reason on
        // screen keeps it; the next sign-in attempt clears it deliberately.
        setState((previous) =>
          previous.status === "signed-out" && previous.message
            ? previous
            : { status: "signed-out" },
        );
        return;
      }
      // Checked before the ticket moves: bumping it here would strand the
      // probe already running for this account and leave the gate checking.
      if (probedUid === user.uid) return;
      probedUid = user.uid;
      handlingUser = true;
      const mine = ++ticket;
      const current = () => active && ticket === mine;
      setState({ status: "checking" });
      const access = await probeFirestoreAccess(user);
      if (!current()) return;
      if (access === "refused") {
        probedUid = null;
        handlingUser = false;
        setState({ status: "signed-out", message: NO_ACCESS_MESSAGE });
        void signOut(firebaseAuth).catch(() => {});
        return;
      }
      // "unreachable" keeps the session: the rules, not this probe, are the
      // boundary, and the dashboard reports whatever error it runs into. The
      // account is left unprobed so a later report asks again rather than
      // carrying one failed read for the rest of the session.
      // ponytail: no retry on reconnect; add one if the shell proves confusing
      // to sit in while every request comes back permission-denied.
      if (access === "unreachable") probedUid = null;
      setState({ status: "allowed", user });
    };

    const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
      void applyUser(user);
    });
    void (async () => {
      try {
        await setPersistence(firebaseAuth, browserLocalPersistence);
        const redirectResult = await getRedirectResult(firebaseAuth);
        if (redirectResult) await applyUser(redirectResult.user);
      } catch (error) {
        // A signed-in account already owns the screen, so a redirect that
        // failed on the side must not push it back to the login form.
        if (!active || handlingUser) return;
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
        // The onAuthStateChanged handler runs the Firestore probe and settles
        // the state, so nothing is decided here.
        await signInWithPopup(auth, provider);
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

        {state.status === "loading" || state.status === "checking" ? (
          <div className="mt-8 h-12 animate-pulse rounded-2xl bg-hover" />
        ) : (
          <button
            type="button"
            disabled={signingIn || missingFirebase}
            onClick={() => void handleGoogleSignIn()}
            className="mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-2xl bg-[#ffffff] px-4 text-sm font-semibold text-[#1f2937] shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:bg-[#f4f4f5] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden="true" className="text-lg font-bold text-blue-600">G</span>
            {signingIn ? "로그인 중..." : "Google 계정으로 로그인"}
          </button>
        )}

        {missingFirebase && (
          <p className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-3 py-2.5 text-xs leading-5 text-amber-200">
            Firebase 환경변수 설정이 필요합니다.
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
