import { useLayoutEffect } from "react";
import { useAuth } from "@/lib/auth";
import { applyTheme, clearTheme, readCachedTheme } from "@/lib/theme";

// Applies the authenticated firm's brand colors to the ERP's live CSS variables.
// Reads the cached theme synchronously (before paint) to avoid a flash of the
// wrong palette, re-applies whenever the signed-in firm changes, and restores
// the default gold/black theme on unmount / logout.
export function ThemeInjector() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? null;

  useLayoutEffect(() => {
    if (tenantId == null) {
      clearTheme();
      return;
    }
    applyTheme(readCachedTheme());
    return () => clearTheme();
  }, [tenantId]);

  return null;
}
