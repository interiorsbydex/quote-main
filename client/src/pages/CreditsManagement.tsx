import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Check, X, Clock, AlertCircle, BarChart3, AlertTriangle, Wallet, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import ThemeToggle from "@/components/ThemeToggle";
import UserMenu from "@/components/UserMenu";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Project, Milestone } from "@/lib/types";
import dexLogo from "@/assets/dex-logo.png";

const PROJECTS_PER_PAGE = 15;

export default function CreditsManagement() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [selectedMilestone, setSelectedMilestone] = useState<Milestone | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['/api/projects'],
  });

  const { data: pendingApprovals = [] } = useQuery<Milestone[]>({
    queryKey: ['/api/milestones/pending-approvals'],
    queryFn: async () => {
      const res = await fetch('/api/milestones/pending-approvals', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch pending approvals');
      return res.json();
    },
    enabled: isAdmin,
  });

  interface DashboardProject {
    projectId: string;
    clientName: string;
    pid: string | null;
    status: string;
    ownerName: string;
    totalCredits: number;
    usedCredits: number;
    availableCredits: number;
    milestones: {
      total: number;
      pending: number;
      submitted: number;
      approved: number;
      rejected: number;
    };
  }

  interface DashboardData {
    summary: {
      totalCreditsInSystem: number;
      totalUsedCredits: number;
      totalAvailableCredits: number;
      projectsWithZeroCredits: number;
      totalPendingApprovals: number;
      totalProjects: number;
    };
    projects: DashboardProject[];
  }

  const { data: dashboard, isLoading: dashboardLoading } = useQuery<DashboardData>({
    queryKey: ['/api/admin/credits-dashboard'],
    queryFn: async () => {
      const res = await fetch('/api/admin/credits-dashboard', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch credits dashboard');
      return res.json();
    },
    enabled: isAdmin,
  });

  const approveMutation = useMutation({
    mutationFn: async (milestoneId: string) => {
      const res = await apiRequest('POST', `/api/milestones/${milestoneId}/approve`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/milestones/pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/credits-dashboard'] });
      toast({ title: "Milestone Approved", description: "Credits have been deducted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      if (!selectedMilestone) return;
      const res = await apiRequest('POST', `/api/milestones/${selectedMilestone.id}/reject`, {
        reason: rejectionReason,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/milestones/pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/credits-dashboard'] });
      toast({ title: "Milestone Rejected", description: "The designer will be notified" });
      setRejectDialogOpen(false);
      setSelectedMilestone(null);
      setRejectionReason("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const filteredProjects = useMemo(() => {
    if (!dashboard?.projects) return [];
    if (!searchQuery.trim()) return dashboard.projects;
    const q = searchQuery.toLowerCase().trim();
    return dashboard.projects.filter(p =>
      p.clientName.toLowerCase().includes(q) ||
      (p.pid && p.pid.toLowerCase().includes(q)) ||
      p.ownerName.toLowerCase().includes(q)
    );
  }, [dashboard?.projects, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredProjects.length / PROJECTS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedProjects = filteredProjects.slice(
    (safeCurrentPage - 1) * PROJECTS_PER_PAGE,
    safeCurrentPage * PROJECTS_PER_PAGE
  );

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  return (
    <div className="min-h-screen bg-background" data-testid="credits-management-page">
      <header className="border-b bg-card sticky top-0 z-50">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-4">
            <Link href="/admin">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <img src={dexLogo} alt="DeX Logo" className="h-8 w-auto" />
            <h1 className="text-xl font-semibold">Credits Overview</h1>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        {isAdmin && pendingApprovals.length > 0 && (
          <Card className="mb-6 border-orange-500" data-testid="card-pending-approvals">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-orange-600">
                <AlertCircle className="h-5 w-5" />
                Pending Approvals ({pendingApprovals.length})
              </CardTitle>
              <CardDescription>These milestones are waiting for your approval</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {pendingApprovals.map((milestone) => {
                  const project = projects.find(p => p.id === milestone.projectId);
                  return (
                    <div key={milestone.id} className="flex items-center justify-between p-3 bg-muted rounded-md" data-testid={`pending-approval-${milestone.id}`}>
                      <div>
                        <p className="font-medium">{milestone.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {project?.clientName || 'Unknown Project'} - {Math.round(milestone.creditAmount).toLocaleString()} Credits
                        </p>
                        {milestone.submittedAt && (
                          <p className="text-xs text-muted-foreground">
                            Submitted {formatDistanceToNow(new Date(milestone.submittedAt), { addSuffix: true })}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => approveMutation.mutate(milestone.id)}
                          disabled={approveMutation.isPending}
                          data-testid={`button-approve-${milestone.id}`}
                        >
                          <Check className="w-4 h-4 mr-1" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            setSelectedMilestone(milestone);
                            setRejectDialogOpen(true);
                          }}
                          data-testid={`button-reject-${milestone.id}`}
                        >
                          <X className="w-4 h-4 mr-1" /> Reject
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {isAdmin && dashboard && (
          <div data-testid="credits-dashboard">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Credits Overview
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
              <Card data-testid="card-system-total-credits">
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground">Total Credits</p>
                  <p className="text-xl font-bold">{Math.round(dashboard.summary.totalCreditsInSystem).toLocaleString()}</p>
                </CardContent>
              </Card>
              <Card data-testid="card-system-used-credits">
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground">Used Credits</p>
                  <p className="text-xl font-bold text-orange-600">{Math.round(dashboard.summary.totalUsedCredits).toLocaleString()}</p>
                </CardContent>
              </Card>
              <Card data-testid="card-system-available-credits">
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground">Available Credits</p>
                  <p className="text-xl font-bold text-green-600">{Math.round(dashboard.summary.totalAvailableCredits).toLocaleString()}</p>
                </CardContent>
              </Card>
              <Card data-testid="card-system-pending-approvals">
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground">Pending Approvals</p>
                  <p className="text-xl font-bold">{dashboard.summary.totalPendingApprovals}</p>
                </CardContent>
              </Card>
              <Card data-testid="card-system-zero-credits">
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> No Credits
                  </p>
                  <p className="text-xl font-bold">{dashboard.summary.projectsWithZeroCredits} / {dashboard.summary.totalProjects}</p>
                </CardContent>
              </Card>
            </div>

            <Card data-testid="card-projects-credit-table">
              <CardHeader>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <CardTitle className="text-base">All Projects - Credit Status</CardTitle>
                    <CardDescription>
                      {filteredProjects.length === dashboard.projects.length
                        ? `${dashboard.projects.length} projects`
                        : `${filteredProjects.length} of ${dashboard.projects.length} projects`
                      }
                    </CardDescription>
                  </div>
                  <div className="relative w-full max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name, PID, or owner..."
                      value={searchQuery}
                      onChange={(e) => handleSearchChange(e.target.value)}
                      className="pl-9"
                      data-testid="input-search-projects"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2 font-medium text-muted-foreground">Project</th>
                        <th className="text-left py-2 px-2 font-medium text-muted-foreground">Owner</th>
                        <th className="text-right py-2 px-2 font-medium text-muted-foreground">Total</th>
                        <th className="text-right py-2 px-2 font-medium text-muted-foreground">Used</th>
                        <th className="text-right py-2 px-2 font-medium text-muted-foreground">Available</th>
                        <th className="text-center py-2 px-2 font-medium text-muted-foreground">Milestones</th>
                        <th className="text-center py-2 px-2 font-medium text-muted-foreground">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedProjects.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="text-center py-8 text-muted-foreground">
                            {searchQuery ? 'No projects match your search' : 'No projects found'}
                          </td>
                        </tr>
                      ) : (
                        paginatedProjects.map((p) => (
                          <tr key={p.projectId} className="border-b last:border-b-0 hover-elevate" data-testid={`credit-row-${p.projectId}`}>
                            <td className="py-2 px-2">
                              <p className="font-medium">{p.clientName}</p>
                              {p.pid && <p className="text-xs text-muted-foreground">{p.pid}</p>}
                            </td>
                            <td className="py-2 px-2 text-muted-foreground">{p.ownerName}</td>
                            <td className="py-2 px-2 text-right font-mono">{Math.round(p.totalCredits).toLocaleString()}</td>
                            <td className="py-2 px-2 text-right font-mono text-orange-600">{Math.round(p.usedCredits).toLocaleString()}</td>
                            <td className="py-2 px-2 text-right font-mono text-green-600">{Math.round(p.availableCredits).toLocaleString()}</td>
                            <td className="py-2 px-2 text-center">
                              <div className="flex items-center justify-center gap-1 flex-wrap">
                                {p.milestones.total > 0 ? (
                                  <>
                                    {p.milestones.approved > 0 && <Badge variant="secondary" className="text-xs">{p.milestones.approved} done</Badge>}
                                    {p.milestones.submitted > 0 && <Badge variant="default" className="text-xs">{p.milestones.submitted} awaiting</Badge>}
                                    {p.milestones.pending > 0 && <Badge variant="outline" className="text-xs">{p.milestones.pending} pending</Badge>}
                                  </>
                                ) : (
                                  <span className="text-xs text-muted-foreground">None</span>
                                )}
                              </div>
                            </td>
                            <td className="py-2 px-2 text-center">
                              <Link href={`/admin/credits/${p.projectId}`}>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  data-testid={`button-manage-project-credits-${p.projectId}`}
                                >
                                  Manage
                                </Button>
                              </Link>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t">
                    <p className="text-sm text-muted-foreground">
                      Page {safeCurrentPage} of {totalPages}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={safeCurrentPage <= 1}
                        data-testid="button-prev-page"
                      >
                        <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={safeCurrentPage >= totalPages}
                        data-testid="button-next-page"
                      >
                        Next <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {dashboardLoading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            Loading credits data...
          </div>
        )}
      </main>

      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Milestone</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting "{selectedMilestone?.name}"
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="rejection-reason">Reason</Label>
            <Textarea
              id="rejection-reason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Enter the reason for rejection..."
              data-testid="input-rejection-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => rejectMutation.mutate()}
              disabled={!rejectionReason || rejectMutation.isPending}
              data-testid="button-confirm-reject"
            >
              Reject Milestone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
