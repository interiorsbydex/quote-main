import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Database, FileText, Folder, User, AlertCircle, CheckCircle, ArrowLeft, Eye, Clock, FileSpreadsheet, Users, IndianRupee, TrendingUp, Building2, ChevronDown, ChevronRight, ExternalLink, GitBranch, Gift, ListChecks } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "wouter";

interface Project {
  id: string;
  clientName: string;
  projectType: string;
  status: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface LineItem {
  id: string;
  projectId: string;
  roomId: string;
}

interface UserType {
  id: string;
  email: string;
  role: string;
}

interface AnalyticsData {
  totalProjects: number;
  totalLineItems: number;
  totalRevenue: number;
  statusBreakdown: Record<string, number>;
  totalUsers: number;
  recentProjects: Project[];
}

interface UserProjectInfo {
  id: string;
  clientName: string;
  pid: string | null;
  status: string;
  projectType: string;
  defaultCategory: string;
  multiStyleEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface UserWithProjects {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  role: string;
  createdAt: string;
  projectCount: number;
  projects: UserProjectInfo[];
}

interface CatalogSyncResult {
  success: boolean;
  totalItems: number;
  // New DeX category counts
  xpressCount: number;
  xpandCount: number;
  xclusiveCount: number;
  accessoriesCount: number;
  servicesCount: number;
  lightsCount: number;
  stoneMasterCount: number;
  handlesCount: number;
  // Legacy counts (for backward compatibility)
  economyCount: number;
  litePremiumCount: number;
  premiumCount: number;
  luxuryCount: number;
  errorCount: number;
  warningCount: number;
  durationMs: number;
  message: string;
}

async function refreshCatalog() {
  const res = await apiRequest('POST', '/api/catalog/refresh', undefined);
  return res.json();
}

export default function AdminDashboard() {
  const { toast } = useToast();
  const { user, isLoading: authLoading } = useAuth();
  const [catalogRefreshTime, setCatalogRefreshTime] = useState<Date | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<CatalogSyncResult | null>(null);
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [userSearchQuery, setUserSearchQuery] = useState("");

  const { data: projects = [], isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ['/api/projects'],
  });

  const { data: allLineItems = [], isLoading: lineItemsLoading } = useQuery<LineItem[]>({
    queryKey: ['/api/line-items/all'],
    enabled: projects.length > 0,
  });

  const { data: analytics } = useQuery<AnalyticsData>({
    queryKey: ['/api/admin/analytics'],
  });

  const { data: usersWithProjects = [], isLoading: usersProjectsLoading } = useQuery<UserWithProjects[]>({
    queryKey: ['/api/admin/users-projects'],
  });

  const refreshCatalogMutation = useMutation({
    mutationFn: refreshCatalog,
    onSuccess: (data: CatalogSyncResult) => {
      setCatalogRefreshTime(new Date());
      setLastSyncResult(data);
      toast({
        title: data.success ? "Success" : "Sync Completed with Warnings",
        description: data.message || `Synced ${data.totalItems} items`,
        variant: data.errorCount > 0 ? "destructive" : "default",
      });
      // Invalidate catalog query to refresh the browser
      queryClient.invalidateQueries({ queryKey: ['/api/admin/catalog'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to refresh catalog",
        variant: "destructive",
      });
    },
  });

  const handleRefreshCatalog = () => {
    refreshCatalogMutation.mutate();
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const isAdminOrSuperAdmin = user && (user.role === "admin" || user.role === "super_admin");
  
  if (!isAdminOrSuperAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6">
            <div className="flex mb-4 gap-2 items-center">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <h1 className="text-2xl font-bold">Access Denied</h1>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              You must be an admin or super admin to access this page.
            </p>
            <Link href="/">
              <Button className="mt-6 w-full" data-testid="button-back-dashboard">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Dashboard
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isLoading = projectsLoading || lineItemsLoading;

  const totalProjects = projects.length;
  const totalLineItems = allLineItems.length;
  const draftProjects = projects.filter(p => p.status === "Draft").length;
  const generatedProjects = projects.filter(p => p.status === "Generated").length;

  const groupedByUser = projects.reduce((acc, project) => {
    acc[project.userId] = (acc[project.userId] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const uniqueUsers = Object.keys(groupedByUser).length;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-semibold">Admin Dashboard</h1>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="default" data-testid="badge-admin-role">
              {user.role === "super_admin" ? "Super Admin" : "Admin"}
            </Badge>
            <Link href="/admin/users">
              <Button variant="outline" size="sm" data-testid="button-manage-users">
                <Users className="mr-2 h-4 w-4" />
                Users
              </Button>
            </Link>
            <Link href="/admin/credits">
              <Button variant="outline" size="sm" data-testid="button-credits-dashboard">
                <IndianRupee className="mr-2 h-4 w-4" />
                Credits
              </Button>
            </Link>
            <Link href="/admin/settings">
              <Button variant="outline" size="sm" data-testid="button-brand-settings">
                <Building2 className="mr-2 h-4 w-4" />
                Branding
              </Button>
            </Link>
            <Link href="/admin/pricing-versions">
              <Button variant="outline" size="sm" data-testid="button-pricing-versions">
                <GitBranch className="mr-2 h-4 w-4" />
                Pricing Versions
              </Button>
            </Link>
            <Link href="/admin/offers">
              <Button variant="outline" size="sm" data-testid="button-manage-offers">
                <Gift className="mr-2 h-4 w-4" />
                Offers
              </Button>
            </Link>
            <Link href="/admin/milestone-settings">
              <Button variant="outline" size="sm" data-testid="button-milestone-settings">
                <ListChecks className="mr-2 h-4 w-4" />
                Milestones
              </Button>
            </Link>
            <Link href="/">
              <Button variant="outline" size="sm" data-testid="button-view-projects">
                <Folder className="mr-2 h-4 w-4" />
                View Projects
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 md:px-6 py-8">
        <div className="space-y-8">
          <div>
            <h2 className="text-2xl font-bold mb-2">System Overview</h2>
            <p className="text-muted-foreground">
              Monitor system health and manage global settings
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Projects</CardTitle>
                <Folder className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-mono font-bold" data-testid="stat-total-projects">
                  {analytics?.totalProjects ?? (isLoading ? "..." : totalProjects)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {draftProjects} Draft, {generatedProjects} Generated
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Line Items</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-mono font-bold" data-testid="stat-total-line-items">
                  {analytics?.totalLineItems ?? (isLoading ? "..." : totalLineItems)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Across all projects
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                <IndianRupee className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-mono font-bold" data-testid="stat-total-revenue">
                  {analytics?.totalRevenue 
                    ? `₹${(analytics.totalRevenue / 100000).toFixed(1)}L` 
                    : "₹0"}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Before taxes
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Team Members</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-mono font-bold" data-testid="stat-total-users">
                  {analytics?.totalUsers ?? (isLoading ? "..." : uniqueUsers)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Registered users
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Catalog Status</CardTitle>
                {catalogRefreshTime ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : (
                  <Database className="h-4 w-4 text-muted-foreground" />
                )}
              </CardHeader>
              <CardContent>
                <div className="text-sm font-medium" data-testid="stat-catalog-status">
                  {catalogRefreshTime ? "Recently Refreshed" : "Ready"}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {catalogRefreshTime
                    ? `Last: ${catalogRefreshTime.toLocaleTimeString()}`
                    : "Google Sheets connected"}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Catalog Management</CardTitle>
              <CardDescription>
                Sync material catalog from Google Sheets and view synced items
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Material Catalog</p>
                  <p className="text-xs text-muted-foreground">
                    Syncs all enabled DeX category sheets from Google Sheets to the catalog draft
                  </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Link href="/admin/catalog">
                    <Button variant="outline" size="sm" data-testid="button-view-catalog">
                      <Eye className="mr-2 h-4 w-4" />
                      Browse Catalog
                    </Button>
                  </Link>
                  <Link href="/admin/test-quotations">
                    <Button variant="outline" size="sm" data-testid="button-test-quotations">
                      <FileSpreadsheet className="mr-2 h-4 w-4" />
                      Test Quotations
                    </Button>
                  </Link>
                  <Button
                    onClick={handleRefreshCatalog}
                    disabled={refreshCatalogMutation.isPending}
                    data-testid="button-refresh-catalog"
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${refreshCatalogMutation.isPending ? 'animate-spin' : ''}`} />
                    {refreshCatalogMutation.isPending ? "Syncing..." : "Sync Now"}
                  </Button>
                </div>
              </div>

              {/* Last Sync Results */}
              {lastSyncResult && (
                <div className={`rounded-md p-4 border ${
                  lastSyncResult.errorCount > 0 
                    ? 'bg-destructive/10 border-destructive/20' 
                    : 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800'
                }`}>
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      {lastSyncResult.errorCount > 0 ? (
                        <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
                      ) : (
                        <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                      )}
                      <div className="flex-1">
                        <p className="font-medium text-sm">
                          {lastSyncResult.success ? 'Sync Successful' : 'Sync Completed with Issues'}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {catalogRefreshTime?.toLocaleString()} · {lastSyncResult.durationMs}ms
                        </p>
                      </div>
                    </div>
                    
                    {/* Row Counts by Category - New DeX Structure */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t">
                      <div>
                        <p className="text-xs text-muted-foreground">Xpress</p>
                        <p className="text-lg font-mono font-semibold" data-testid="count-xpress">
                          {lastSyncResult.xpressCount || 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Xpand</p>
                        <p className="text-lg font-mono font-semibold" data-testid="count-xpand">
                          {lastSyncResult.xpandCount || 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Xclusive</p>
                        <p className="text-lg font-mono font-semibold" data-testid="count-xclusive">
                          {lastSyncResult.xclusiveCount || 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Accessories</p>
                        <p className="text-lg font-mono font-semibold" data-testid="count-accessories">
                          {lastSyncResult.accessoriesCount || 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Services</p>
                        <p className="text-lg font-mono font-semibold" data-testid="count-services">
                          {lastSyncResult.servicesCount || 0}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <p className="text-xs text-muted-foreground">Lights</p>
                        <p className="text-lg font-mono font-semibold" data-testid="count-lights">
                          {lastSyncResult.lightsCount || 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Stone Master</p>
                        <p className="text-lg font-mono font-semibold" data-testid="count-stone-master">
                          {lastSyncResult.stoneMasterCount || 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Handles</p>
                        <p className="text-lg font-mono font-semibold" data-testid="count-handles">
                          {lastSyncResult.handlesCount || 0}
                        </p>
                      </div>
                    </div>

                    {/* Total and Quality Indicators */}
                    <div className="flex items-center gap-4 pt-2 border-t text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Total:</span>
                        <span className="font-mono font-semibold" data-testid="count-total">
                          {lastSyncResult.totalItems} items
                        </span>
                      </div>
                      {lastSyncResult.warningCount > 0 && (
                        <Badge variant="secondary" className="gap-1">
                          <AlertCircle className="h-3 w-3" />
                          {lastSyncResult.warningCount} warnings
                        </Badge>
                      )}
                      {lastSyncResult.errorCount > 0 && (
                        <Badge variant="destructive" className="gap-1">
                          <AlertCircle className="h-3 w-3" />
                          {lastSyncResult.errorCount} errors
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* No sync yet */}
              {!lastSyncResult && !catalogRefreshTime && (
                <div className="rounded-md bg-muted p-4 border">
                  <div className="flex gap-2 items-start">
                    <Clock className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium">No recent sync</p>
                      <p className="text-muted-foreground mt-1">
                        Click "Sync Now" to fetch catalog data from Google Sheets
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Users &amp; Projects</CardTitle>
              <CardDescription>
                All users and their projects across the system
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <Input
                  placeholder="Search by username or project name..."
                  value={userSearchQuery}
                  onChange={(e) => setUserSearchQuery(e.target.value)}
                  data-testid="input-users-projects-search"
                />
              </div>
              {usersProjectsLoading ? (
                <div className="text-sm text-muted-foreground">Loading users and projects...</div>
              ) : usersWithProjects.length === 0 ? (
                <div className="text-sm text-muted-foreground">No users found</div>
              ) : (
                <div className="space-y-2" data-testid="users-projects-list">
                  {usersWithProjects
                    .filter(u => {
                      if (!userSearchQuery.trim()) return true;
                      const q = userSearchQuery.toLowerCase();
                      const nameMatch = u.username.toLowerCase().includes(q) ||
                        (u.firstName || "").toLowerCase().includes(q) ||
                        (u.lastName || "").toLowerCase().includes(q);
                      const projectMatch = u.projects.some(p =>
                        p.clientName.toLowerCase().includes(q) ||
                        (p.pid || "").toLowerCase().includes(q)
                      );
                      return nameMatch || projectMatch;
                    })
                    .map(u => {
                      const isExpanded = expandedUsers.has(u.id);
                      const displayName = (u.firstName && u.lastName)
                        ? `${u.firstName} ${u.lastName}`
                        : u.username;
                      const toggleExpand = () => {
                        setExpandedUsers(prev => {
                          const next = new Set(prev);
                          if (next.has(u.id)) next.delete(u.id);
                          else next.add(u.id);
                          return next;
                        });
                      };
                      const draftCount = u.projects.filter(p => p.status === "Draft").length;
                      const generatedCount = u.projects.filter(p => p.status === "Generated").length;

                      return (
                        <div key={u.id} className="border rounded-md" data-testid={`user-card-${u.id}`}>
                          <button
                            onClick={toggleExpand}
                            className="w-full flex items-center justify-between gap-2 p-3 text-left hover-elevate rounded-md"
                            data-testid={`button-expand-user-${u.id}`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="flex-shrink-0 h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                                <User className="h-4 w-4 text-muted-foreground" />
                              </div>
                              <div className="min-w-0">
                                <div className="font-medium text-sm truncate">{displayName}</div>
                                {displayName !== u.username && (
                                  <div className="text-xs text-muted-foreground truncate">@{u.username}</div>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <Badge variant="secondary">
                                {u.role === "super_admin" ? "Super Admin" : u.role === "admin" ? "Admin" : "User"}
                              </Badge>
                              <Badge variant="outline">
                                {u.projectCount} {u.projectCount === 1 ? "project" : "projects"}
                              </Badge>
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>
                          </button>

                          {isExpanded && (
                            <div className="border-t px-3 pb-3">
                              {u.projects.length === 0 ? (
                                <p className="text-sm text-muted-foreground py-3">No projects yet</p>
                              ) : (
                                <>
                                  <div className="flex items-center gap-3 py-2 text-xs text-muted-foreground">
                                    <span>{draftCount} Draft</span>
                                    <span>{generatedCount} Generated</span>
                                  </div>
                                  <div className="space-y-1">
                                    {u.projects.map(p => (
                                      <Link key={p.id} href={`/project/${p.id}`}>
                                        <div
                                          className="flex items-center justify-between gap-2 py-2 px-2 rounded hover-elevate cursor-pointer"
                                          data-testid={`project-row-${p.id}`}
                                        >
                                          <div className="min-w-0 flex-1">
                                            <div className="text-sm font-medium truncate">
                                              {p.clientName}
                                              {p.pid && <span className="text-muted-foreground ml-1">({p.pid})</span>}
                                            </div>
                                            <div className="text-xs text-muted-foreground">
                                              {p.multiStyleEnabled ? "Multi-Style" : p.defaultCategory || p.projectType}
                                              {" · "}
                                              Updated {new Date(p.updatedAt).toLocaleDateString()}
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-2 flex-shrink-0">
                                            <Badge
                                              variant={p.status === "Generated" ? "default" : "secondary"}
                                            >
                                              {p.status}
                                            </Badge>
                                            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                                          </div>
                                        </div>
                                      </Link>
                                    ))}
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
