"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "./icons";

export type Theme = "dark" | "light";

const THEME_STORAGE_KEY = "gagebu:theme";
const THEME_EVENT = "gagebu:theme-change";

// The inline script in the layout stamps data-theme before paint, so the DOM
// itself is the source of truth and hydration never flashes the wrong icon.
function subscribe(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "dark" as Theme);
  const isDark = theme === "dark";

  const toggle = () => {
    const next: Theme = isDark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private-mode storage failures should not break the toggle.
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "라이트 모드로 전환" : "다크 모드로 전환"}
      title={isDark ? "라이트 모드" : "다크 모드"}
      className={`group inline-flex h-11 w-11 items-center justify-center rounded-2xl lg:h-10 lg:w-10 border border-line bg-card text-muted transition hover:-translate-y-0.5 hover:border-line-strong hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 ${className}`}
    >
      <span className="transition-transform duration-300 group-hover:rotate-12">
        <Icon name={isDark ? "sun" : "moon"} size={17} />
      </span>
    </button>
  );
}
