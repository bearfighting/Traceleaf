"use client";

import { useEffect, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";

type ThemePreference = "system" | "light" | "dark";

const preferences: ThemePreference[] = ["system", "light", "dark"];

function getThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem("traceleaf-theme");
    return preferences.find((item) => item === stored) ?? "system";
  } catch {
    return "system";
  }
}

function subscribeToThemePreference(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("traceleaf-theme-change", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("traceleaf-theme-change", onChange);
  };
}

function getServerThemePreference(): ThemePreference {
  return "system";
}

function applyTheme(preference: ThemePreference) {
  const resolved =
    preference === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preference;

  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference;
}

export function ThemeControl({ label }: { label: string }) {
  const preference = useSyncExternalStore(
    subscribeToThemePreference,
    getThemePreference,
    getServerThemePreference,
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => {
      if (getThemePreference() === "system") applyTheme("system");
    };
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, []);

  function cycleTheme() {
    const next = preferences[(preferences.indexOf(preference) + 1) % preferences.length];
    try {
      window.localStorage.setItem("traceleaf-theme", next);
    } catch {
      // Keep the current page theme even when storage is unavailable.
    }
    applyTheme(next);
    window.dispatchEvent(new Event("traceleaf-theme-change"));
  }

  const nextLabel = preference === "system" ? "light" : preference === "light" ? "dark" : "system";

  return (
    <Button
      aria-label={`${label}: ${preference}. Switch to ${nextLabel} theme.`}
      className="size-10 px-0 text-muted-foreground"
      onClick={cycleTheme}
      title={`${label}: ${preference}`}
      type="button"
      variant="secondary"
    >
      <span aria-hidden="true" className="theme-glyph">
        {preference === "system" ? "◐" : preference === "light" ? "☼" : "☾"}
      </span>
    </Button>
  );
}
