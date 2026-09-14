import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

interface CompanySettings {
  appName?: string;
  logoUrl?: string;
}

export function useDynamicBranding() {
  const { data: settings } = useQuery<CompanySettings>({
    queryKey: ["/api/company-settings/public"],
  });

  useEffect(() => {
    if (!settings) return;

    // Update favicon if logo is available
    if (settings.logoUrl) {
      const existingFavicon = document.querySelector('link[rel="icon"]');
      if (existingFavicon) {
        existingFavicon.setAttribute("href", settings.logoUrl);
      } else {
        const newFavicon = document.createElement("link");
        newFavicon.rel = "icon";
        newFavicon.href = settings.logoUrl;
        document.head.appendChild(newFavicon);
      }
    }

    // Update page title if app name is available
    if (settings.appName) {
      document.title = `${settings.appName} - Dynamic Quotation System`;
    }
  }, [settings]);

  return settings;
}
