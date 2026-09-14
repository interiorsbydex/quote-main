import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Monitor, Smartphone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  
  const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
  const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile|tablet/i;
  
  const isMobileUA = mobileRegex.test(userAgent.toLowerCase());
  const isSmallScreen = window.innerWidth < 768;
  
  return isMobileUA || isSmallScreen;
}

function isPublicRoute(pathname: string): boolean {
  return pathname.startsWith('/quote/');
}

interface MobileBlockerProps {
  children: React.ReactNode;
}

export default function MobileBlocker({ children }: MobileBlockerProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [checked, setChecked] = useState(false);
  const [location] = useLocation();

  useEffect(() => {
    const checkDevice = () => {
      setIsMobile(isMobileDevice());
      setChecked(true);
    };

    checkDevice();
    
    window.addEventListener("resize", checkDevice);
    return () => window.removeEventListener("resize", checkDevice);
  }, []);

  if (!checked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (isMobile && !isPublicRoute(location)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center" data-testid="card-mobile-blocker">
          <CardHeader className="space-y-4">
            <div className="mx-auto flex items-center justify-center w-16 h-16 rounded-full bg-muted">
              <Smartphone className="h-8 w-8 text-muted-foreground" />
            </div>
            <CardTitle className="text-xl" data-testid="text-mobile-title">
              Desktop Access Required
            </CardTitle>
            <CardDescription className="text-base" data-testid="text-mobile-description">
              This application is designed for desktop use to provide the best experience for creating detailed quotations.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Monitor className="h-5 w-5" />
              <span>Please access this application on a desktop or laptop computer</span>
            </div>
            <div className="pt-4 border-t">
              <p className="text-sm text-muted-foreground">
                For the best experience, we recommend using Chrome, Firefox, or Safari on a screen width of at least 768px.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
