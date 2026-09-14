import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CompanySettings } from "@shared/schema";

export default function Landing() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { toast } = useToast();

  // Fetch company settings for logo and app name
  const { data: companySettings } = useQuery<CompanySettings>({
    queryKey: ["/api/company-settings/public"],
    retry: false,
  });

  const appName = companySettings?.appName || "Quote Builder";

  const loginMutation = useMutation({
    mutationFn: async (credentials: { username: string; password: string }) => {
      const response = await apiRequest("POST", "/api/login", credentials);
      return response;
    },
    onSuccess: () => {
      window.location.href = "/";
    },
    onError: (error: any) => {
      toast({
        title: "Login Failed",
        description: error.message || "Invalid username or password",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast({
        title: "Validation Error",
        description: "Please enter both username and password",
        variant: "destructive",
      });
      return;
    }
    loginMutation.mutate({ username, password });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 md:px-6">
        <nav className="h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {companySettings?.logoUrl ? (
              <img 
                src={companySettings.logoUrl} 
                alt={appName}
                className="h-8 w-auto object-contain"
              />
            ) : (
              <FileText className="h-6 w-6 text-primary" />
            )}
            <h1 className="text-xl font-semibold">{appName}</h1>
          </div>
          <ThemeToggle />
        </nav>

        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] py-12">
          <div className="w-full max-w-md mb-12">
            <Card>
              <CardHeader className="text-center">
                <CardTitle className="text-2xl">Welcome Back</CardTitle>
                <CardDescription>
                  Sign in to your {appName} account
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <Input
                      id="username"
                      type="text"
                      placeholder="Enter your username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      data-testid="input-username"
                      disabled={loginMutation.isPending}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      data-testid="input-password"
                      disabled={loginMutation.isPending}
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={loginMutation.isPending}
                    data-testid="button-submit-login"
                  >
                    {loginMutation.isPending ? "Logging in..." : "Log In"}
                  </Button>
                </form>

              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
