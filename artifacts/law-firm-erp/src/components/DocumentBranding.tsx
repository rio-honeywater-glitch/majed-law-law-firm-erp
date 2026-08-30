import { useEffect } from "react";
import { useAuth } from "@/lib/auth";

const FIRM_NAME = "مكتب المحامي ماجد بن سلطان السبيعي";
const FALLBACK_TITLE = `${FIRM_NAME} | نظام إدارة المكتب`;
const DEFAULT_FAVICON = `${import.meta.env.BASE_URL}default-favicon.svg`;

function setFavicon(href: string) {
  let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.removeAttribute("type");
  link.href = href;
}

export function DocumentBranding() {
  const { user, branding } = useAuth();

  useEffect(() => {
    if (user) {
      document.title = FALLBACK_TITLE;
      setFavicon(branding?.logoUrl || DEFAULT_FAVICON);
    } else {
      document.title = FALLBACK_TITLE;
      setFavicon(DEFAULT_FAVICON);
    }
  }, [user, branding]);

  return null;
}
