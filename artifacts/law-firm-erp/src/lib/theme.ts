// Per-tenant theming: extract brand colors from a firm's logo, cache them, and
// inject them as the ERP's live CSS variables. Colors degrade to the default
// gold/black palette whenever a firm has no usable extracted colors.

export interface TenantTheme {
  primaryColor: string | null;
  secondaryColor: string | null;
}

const CACHE_KEY = "auth_theme";

// ─── hex ⇄ hsl ──────────────────────────────────────────────────────────────
interface Hsl {
  h: number;
  s: number;
  l: number;
}

function hexToHsl(hex: string): Hsl | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return 0;
  const int = parseInt(m[1], 16);
  const chan = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

const hsl = ({ h, s, l }: Hsl) => `${h} ${s}% ${l}%`;
// Dark text on light brand colors, light text on dark ones (WCAG-ish threshold).
const contrastFg = (hex: string) => (relativeLuminance(hex) > 0.4 ? "0 0% 10%" : "0 0% 98%");

// ─── build the CSS variable overrides ───────────────────────────────────────
// Reuses the existing CSS-variable theme (index.css) rather than a parallel
// system. Primary drives every accent (buttons, active nav, rings, charts);
// secondary tints the dark sidebar chrome while staying readable.
export function buildThemeVars(theme: TenantTheme): Record<string, string> {
  const vars: Record<string, string> = {};
  const primary = theme.primaryColor ? hexToHsl(theme.primaryColor) : null;
  if (primary) {
    const pfg = contrastFg(theme.primaryColor!);
    const p = hsl(primary);
    vars["--primary"] = p;
    vars["--primary-foreground"] = pfg;
    vars["--ring"] = p;
    vars["--chart-1"] = p;
    vars["--sidebar-primary"] = p;
    vars["--sidebar-primary-foreground"] = pfg;
    vars["--sidebar-ring"] = p;
    // Gold-on-black sidebar text becomes a light tint of the brand hue.
    const softSat = Math.min(primary.s, 60);
    vars["--sidebar-foreground"] = `${primary.h} ${softSat}% 85%`;
    vars["--sidebar-accent-foreground"] = `${primary.h} ${softSat}% 95%`;
    vars["--accent-foreground"] = `${primary.h} ${Math.min(primary.s, 60)}% 30%`;
  }

  const secondary = theme.secondaryColor ? hexToHsl(theme.secondaryColor) : null;
  if (secondary) {
    // Clamp the sidebar background dark enough to keep light text readable,
    // preserving the brand hue for a subtly tinted chrome per firm.
    const bgL = Math.min(secondary.l, 10);
    const bgS = Math.min(secondary.s, 60);
    vars["--sidebar"] = `${secondary.h} ${bgS}% ${bgL}%`;
    vars["--sidebar-accent"] = `${secondary.h} ${bgS}% ${bgL + 8}%`;
    vars["--sidebar-border"] = `${secondary.h} ${Math.min(secondary.s, 40)}% ${bgL + 12}%`;
    vars["--secondary"] = `${secondary.h} ${Math.min(secondary.s, 40)}% 18%`;
    vars["--secondary-foreground"] = "0 0% 98%";
  }

  return vars;
}

const MANAGED_VARS = [
  "--primary",
  "--primary-foreground",
  "--ring",
  "--chart-1",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-ring",
  "--sidebar-foreground",
  "--sidebar-accent-foreground",
  "--accent-foreground",
  "--sidebar",
  "--sidebar-accent",
  "--sidebar-border",
  "--secondary",
  "--secondary-foreground",
];

// Applied on :root (document element) so the relative-color *-border helpers
// declared in index.css recompute from the overridden base variables.
export function applyTheme(theme: TenantTheme): void {
  const root = document.documentElement;
  const vars = buildThemeVars(theme);
  for (const name of MANAGED_VARS) {
    if (vars[name] != null) root.style.setProperty(name, vars[name]);
    else root.style.removeProperty(name);
  }
}

export function clearTheme(): void {
  const root = document.documentElement;
  for (const name of MANAGED_VARS) root.style.removeProperty(name);
}

// ─── cache (localStorage) ────────────────────────────────────────────────────
export function cacheTheme(theme: TenantTheme | null | undefined): void {
  try {
    if (theme && (theme.primaryColor || theme.secondaryColor)) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(theme));
    } else {
      localStorage.removeItem(CACHE_KEY);
    }
  } catch {
    /* ignore storage errors */
  }
}

export function readCachedTheme(): TenantTheme {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TenantTheme;
      return {
        primaryColor: parsed.primaryColor ?? null,
        secondaryColor: parsed.secondaryColor ?? null,
      };
    }
  } catch {
    /* ignore */
  }
  return { primaryColor: null, secondaryColor: null };
}

export function clearCachedTheme(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

// ─── tenant branding (firm name + logo) cache ───────────────────────────────
export interface TenantBranding {
  name: string;
  logoUrl: string | null;
}

const BRANDING_KEY = "auth_branding";

export function cacheBranding(branding: TenantBranding | null | undefined): void {
  try {
    if (branding && branding.name) {
      localStorage.setItem(BRANDING_KEY, JSON.stringify(branding));
    } else {
      localStorage.removeItem(BRANDING_KEY);
    }
  } catch {
    /* ignore storage errors */
  }
}

export function readCachedBranding(): TenantBranding | null {
  try {
    const raw = localStorage.getItem(BRANDING_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TenantBranding;
      if (parsed && typeof parsed.name === "string" && parsed.name) {
        return { name: parsed.name, logoUrl: parsed.logoUrl ?? null };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function clearCachedBranding(): void {
  try {
    localStorage.removeItem(BRANDING_KEY);
  } catch {
    /* ignore */
  }
}

// ─── logo color extraction (client-side canvas) ──────────────────────────────
function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}

function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const d = max - min;
  return d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
}

function hueOf(r: number, g: number, b: number): number {
  const rr = r / 255,
    gg = g / 255,
    bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  if (d === 0) return 0;
  let h = 0;
  if (max === rr) h = ((gg - bb) / d) % 6;
  else if (max === gg) h = (bb - rr) / d + 2;
  else h = (rr - gg) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

// Extract a primary + secondary brand color from a logo data URL. Returns nulls
// when the image has no clear (saturated) palette, so callers fall back cleanly.
export async function extractLogoColors(dataUrl: string): Promise<TenantTheme> {
  const empty: TenantTheme = { primaryColor: null, secondaryColor: null };
  try {
    const img = await loadImage(dataUrl);
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return empty;
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    // Bucket saturated, non-extreme pixels by a coarse RGB quantization.
    const buckets = new Map<string, { r: number; g: number; b: number; count: number }>();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2],
        a = data[i + 3];
      if (a < 128) continue;
      const sat = saturation(r, g, b);
      const lum = (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
      // Skip near-white, near-black and washed-out grays.
      if (sat < 0.2 || lum < 0.08 || lum > 0.94) continue;
      const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
        bucket.count++;
      } else {
        buckets.set(key, { r, g, b, count: 1 });
      }
    }

    if (buckets.size === 0) return empty;
    const sorted = [...buckets.values()].sort((a, b) => b.count - a.count);
    const avg = (x: { r: number; g: number; b: number; count: number }) =>
      rgbToHex(Math.round(x.r / x.count), Math.round(x.g / x.count), Math.round(x.b / x.count));

    const primaryBucket = sorted[0];
    const primaryColor = avg(primaryBucket);
    const primaryHue = hueOf(
      primaryBucket.r / primaryBucket.count,
      primaryBucket.g / primaryBucket.count,
      primaryBucket.b / primaryBucket.count,
    );

    // Secondary: the next frequent bucket whose hue is clearly distinct (>40°).
    let secondaryColor: string | null = null;
    for (let i = 1; i < sorted.length; i++) {
      const b = sorted[i];
      const hue = hueOf(b.r / b.count, b.g / b.count, b.b / b.count);
      let diff = Math.abs(hue - primaryHue);
      if (diff > 180) diff = 360 - diff;
      if (diff > 40) {
        secondaryColor = avg(b);
        break;
      }
    }

    return { primaryColor, secondaryColor };
  } catch {
    return empty;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
