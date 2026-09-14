import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Check, X, Clock, TrendingDown, TrendingUp, Wallet, AlertCircle, Share2, Copy, LinkIcon, Trash2, IndianRupee, CreditCard } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import ThemeToggle from "@/components/ThemeToggle";
import UserMenu from "@/components/UserMenu";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Project, Milestone, CreditTransaction, ProjectCredits } from "@/lib/types";
import { CREDIT_REQUEST_TYPES, CREDIT_CAPS } from "@shared/schema";
import type { CreditRequestType } from "@shared/schema";
import dexLogo from "@/assets/dex-logo.png";

interface CreditRequest {
  id: string;
  projectId: string;
  requestType: string;
  amount: number;
  status: string;
  paymentReference: string | null;
  rejectionReason: string | null;
  requestedBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

interface WalletFundingEntry {
  id: string;
  projectId: string;
  amount: number;
  description: string;
  paymentReference: string | null;
  createdBy: string;
  createdAt: string;
}

interface ProjectCreditsDetailProps {
  params: { projectId: string };
}

interface MilestoneStage {
  id: string;
  key: string;
  name: string;
  creditAmount: number;
  category: "mandatory" | "additional";
}

export default function ProjectCreditsDetail({ params }: ProjectCreditsDetailProps) {
  const projectId = params.projectId;
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const [requestCreditsOpen, setRequestCreditsOpen] = useState(false);
  const [requestType, setRequestType] = useState<CreditRequestType | "">("");
  const [paymentReference, setPaymentReference] = useState("");
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [selectedMilestone, setSelectedMilestone] = useState<Milestone | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [createMilestoneOpen, setCreateMilestoneOpen] = useState(false);
  const [milestoneType, setMilestoneType] = useState("");
  const [milestoneRoomId, setMilestoneRoomId] = useState("");
  const [milestoneDescription, setMilestoneDescription] = useState("");
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [setWalletOpen, setSetWalletOpen] = useState(false);
  const [walletTotal, setWalletTotal] = useState("");
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDescription, setPaymentDescription] = useState("");
  const [paymentRef, setPaymentRef] = useState("");
  const [rejectCreditRequestDialogOpen, setRejectCreditRequestDialogOpen] = useState(false);
  const [selectedCreditRequest, setSelectedCreditRequest] = useState<CreditRequest | null>(null);
  const [creditRequestRejectionReason, setCreditRequestRejectionReason] = useState("");

  const { data: project } = useQuery<Project>({
    queryKey: ['/api/projects', projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch project');
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data: credits, isLoading: creditsLoading } = useQuery<ProjectCredits & { projectWallet?: number; walletFunded?: number; walletBalance?: number }>({
    queryKey: ['/api/projects', projectId, 'credits'],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/credits`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch credits');
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data: transactions = [] } = useQuery<CreditTransaction[]>({
    queryKey: ['/api/projects', projectId, 'credits', 'transactions'],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/credits/transactions`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch transactions');
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data: milestones = [] } = useQuery<Milestone[]>({
    queryKey: ['/api/projects', projectId, 'milestones'],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/milestones`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch milestones');
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data: milestoneStages = [] } = useQuery<MilestoneStage[]>({
    queryKey: ["/api/milestone-stages"],
  });

  const { data: creditRequests = [] } = useQuery<CreditRequest[]>({
    queryKey: ['/api/projects', projectId, 'credit-requests'],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/credit-requests`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch credit requests');
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data: rooms = [] } = useQuery<{ id: string; roomName: string }[]>({
    queryKey: ['/api/projects', projectId, 'rooms'],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/rooms`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch rooms');
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data: walletEntries = [] } = useQuery<WalletFundingEntry[]>({
    queryKey: ['/api/projects', projectId, 'wallet', 'entries'],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/wallet/entries`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch wallet entries');
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data: shareStatus } = useQuery<{ creditsShareToken: string | null; creditsShareExpiresAt: string | null; shareUrl: string | null }>({
    queryKey: ['/api/projects', projectId, 'credits', 'share'],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/credits/share`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch share status');
      return res.json();
    },
    enabled: !!projectId && isAdmin,
  });

  const generateShareMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/projects/${projectId}/credits/share`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'credits', 'share'] });
      const fullUrl = `${window.location.origin}${data.shareUrl}`;
      navigator.clipboard.writeText(fullUrl).then(() => {
        toast({ title: "Link Generated & Copied", description: "Credits portal link has been copied to your clipboard" });
      }).catch(() => {
        toast({ title: "Link Generated", description: fullUrl });
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const revokeShareMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('DELETE', `/api/projects/${projectId}/credits/share`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'credits', 'share'] });
      toast({ title: "Link Revoked", description: "The client credits link has been disabled" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const copyShareLink = () => {
    if (shareStatus?.shareUrl) {
      const fullUrl = `${window.location.origin}${shareStatus.shareUrl}`;
      navigator.clipboard.writeText(fullUrl).then(() => {
        toast({ title: "Link Copied", description: "Credits portal link copied to clipboard" });
      }).catch(() => {
        toast({ title: "Share Link", description: fullUrl });
      });
    }
  };

  const requestCreditsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/projects/${projectId}/credit-requests`, {
        requestType,
        paymentReference: paymentReference || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'credits'] });
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'credits', 'transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'credit-requests'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/credits-dashboard'] });
      toast({ title: "Credit Request Submitted", description: "Your credit request has been submitted for approval" });
      setRequestCreditsOpen(false);
      setRequestType("");
      setPaymentReference("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const approveCreditRequestMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('POST', `/api/credit-requests/${id}/approve`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'credits'] });
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'credits', 'transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'credit-requests'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/credits-dashboard'] });
      toast({ title: "Credit Request Approved", description: "Credits have been added to the project" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const rejectCreditRequestMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCreditRequest) return;
      const res = await apiRequest('POST', `/api/credit-requests/${selectedCreditRequest.id}/reject`, {
        reason: creditRequestRejectionReason,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'credit-requests'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/credits-dashboard'] });
      toast({ title: "Credit Request Rejected", description: "The requester will be notified" });
      setRejectCreditRequestDialogOpen(false);
      setSelectedCreditRequest(null);
      setCreditRequestRejectionReason("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (milestoneId: string) => {
      const res = await apiRequest('POST', `/api/milestones/${milestoneId}/approve`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'credits'] });
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'credits', 'transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'milestones'] });
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
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'milestones'] });
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

  const createMilestoneMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/projects/${projectId}/milestones`, {
        milestoneType,
        roomId: milestoneRoomId || undefined,
        description: milestoneDescription || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'milestones'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/credits-dashboard'] });
      const typeInfo = milestoneStages.find((stage) => stage.key === milestoneType);
      toast({ title: "Milestone Created", description: `Created milestone "${typeInfo?.name || milestoneType}"` });
      setCreateMilestoneOpen(false);
      setMilestoneType("");
      setMilestoneRoomId("");
      setMilestoneDescription("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const submitMilestoneMutation = useMutation({
    mutationFn: async (milestoneId: string) => {
      const res = await apiRequest('POST', `/api/milestones/${milestoneId}/submit`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'milestones'] });
      queryClient.invalidateQueries({ queryKey: ['/api/milestones/pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/credits-dashboard'] });
      toast({ title: "Milestone Submitted", description: "Submitted for manager approval" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const setWalletTotalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/projects/${projectId}/wallet/set-total`, {
        projectWallet: parseFloat(walletTotal),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'credits'] });
      toast({ title: "Wallet Updated", description: "Project wallet total has been set" });
      setSetWalletOpen(false);
      setWalletTotal("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/projects/${projectId}/wallet/fund`, {
        amount: parseFloat(paymentAmount),
        description: paymentDescription,
        paymentReference: paymentRef || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'credits'] });
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'wallet', 'entries'] });
      toast({ title: "Payment Recorded", description: "Wallet funding has been recorded" });
      setRecordPaymentOpen(false);
      setPaymentAmount("");
      setPaymentDescription("");
      setPaymentRef("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary" data-testid="badge-status-pending"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
      case 'submitted':
        return <Badge variant="default" data-testid="badge-status-submitted"><AlertCircle className="w-3 h-3 mr-1" /> Awaiting Approval</Badge>;
      case 'approved':
        return <Badge className="bg-green-600" data-testid="badge-status-approved"><Check className="w-3 h-3 mr-1" /> Approved</Badge>;
      case 'rejected':
        return <Badge variant="destructive" data-testid="badge-status-rejected"><X className="w-3 h-3 mr-1" /> Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const usedMandatoryTypes = milestones
    .filter((m) => m.milestoneType && ['pending', 'submitted', 'approved'].includes(m.status))
    .map((m) => m.milestoneType);

  const selectedMilestoneTypeInfo = milestoneStages.find((stage) => stage.key === milestoneType);
  const isAdditionalMilestone = selectedMilestoneTypeInfo?.category === 'additional';

  const selectedRequestTypeInfo = requestType ? CREDIT_REQUEST_TYPES[requestType as CreditRequestType] : null;

  const getRequestTypeMaxError = (): string | null => {
    if (!requestType) return null;
    const typeInfo = CREDIT_REQUEST_TYPES[requestType as CreditRequestType];
    if (!typeInfo) return null;
    const existingOfType = creditRequests.filter(
      (r) => r.requestType === requestType && (r.status === 'pending' || r.status === 'approved')
    );
    if (existingOfType.length >= typeInfo.maxPerProject) {
      return `Maximum ${typeInfo.maxPerProject} "${typeInfo.label}" request(s) allowed per project. Already used ${existingOfType.length}.`;
    }
    return null;
  };

  const requestTypeError = getRequestTypeMaxError();

  if (creditsLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading credits...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" data-testid="project-credits-detail-page">
      <header className="border-b bg-card sticky top-0 z-50">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-4">
            <Link href="/admin/credits">
              <Button variant="ghost" size="icon" data-testid="button-back-to-credits">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <img src={dexLogo} alt="DeX Logo" className="h-8 w-auto" />
            <div>
              <h1 className="text-xl font-semibold">Credits Management</h1>
              {project && (
                <p className="text-sm text-muted-foreground">
                  {project.pid ? `${project.pid} - ` : ''}{project.clientName}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" data-testid="button-share-credits">
                    <Share2 className="h-4 w-4 mr-1" /> Share with Client
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Client Credits Portal</DialogTitle>
                    <DialogDescription>
                      Share a link with your client so they can view their credit balance, milestone progress, and transaction history.
                    </DialogDescription>
                  </DialogHeader>
                  {shareStatus?.creditsShareToken ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <Input
                          readOnly
                          value={`${window.location.origin}${shareStatus.shareUrl}`}
                          className="text-sm"
                          data-testid="input-share-link"
                        />
                        <Button size="icon" variant="outline" onClick={copyShareLink} data-testid="button-copy-share-link">
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      {shareStatus.creditsShareExpiresAt && (
                        <p className="text-xs text-muted-foreground">
                          Expires: {format(new Date(shareStatus.creditsShareExpiresAt), "MMM d, yyyy")}
                        </p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => generateShareMutation.mutate()}
                          disabled={generateShareMutation.isPending}
                          data-testid="button-regenerate-link"
                        >
                          <LinkIcon className="h-3 w-3 mr-1" /> Regenerate Link
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => revokeShareMutation.mutate()}
                          disabled={revokeShareMutation.isPending}
                          data-testid="button-revoke-link"
                        >
                          <Trash2 className="h-3 w-3 mr-1" /> Revoke Link
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        No active link. Generate one to share with your client. The link will expire after 30 days.
                      </p>
                      <Button
                        onClick={() => generateShareMutation.mutate()}
                        disabled={generateShareMutation.isPending}
                        data-testid="button-generate-link"
                      >
                        <LinkIcon className="h-4 w-4 mr-2" />
                        {generateShareMutation.isPending ? "Generating..." : "Generate Share Link"}
                      </Button>
                    </div>
                  )}
                </DialogContent>
              </Dialog>
            )}
            <Link href={`/project/${projectId}`}>
              <Button variant="outline" size="sm" data-testid="button-view-project">
                View Project
              </Button>
            </Link>
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="p-6 max-w-5xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card data-testid="card-total-credits">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Credits</p>
                  <p className="text-2xl font-bold">{Math.round(credits?.totalCredits || 0).toLocaleString()} Credits</p>
                </div>
                <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-full">
                  <CreditCard className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-used-credits">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Used Credits</p>
                  <p className="text-2xl font-bold">{Math.round(credits?.usedCredits || 0).toLocaleString()} Credits</p>
                </div>
                <div className="p-3 bg-orange-100 dark:bg-orange-900 rounded-full">
                  <TrendingDown className="h-6 w-6 text-orange-600 dark:text-orange-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-available-credits">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Available Credits</p>
                  <p className="text-2xl font-bold text-green-600">{Math.round(credits?.availableCredits || 0).toLocaleString()} Credits</p>
                </div>
                <div className="p-3 bg-green-100 dark:bg-green-900 rounded-full">
                  <TrendingUp className="h-6 w-6 text-green-600 dark:text-green-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card data-testid="card-project-wallet">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Project Wallet</p>
                  <p className="text-2xl font-bold">{'\u20B9'}{Math.round(credits?.projectWallet || 0).toLocaleString()}</p>
                </div>
                <div className="p-3 bg-purple-100 dark:bg-purple-900 rounded-full">
                  <Wallet className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-wallet-funded">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Wallet Funded</p>
                  <p className="text-2xl font-bold">{'\u20B9'}{Math.round(credits?.walletFunded || 0).toLocaleString()}</p>
                </div>
                <div className="p-3 bg-teal-100 dark:bg-teal-900 rounded-full">
                  <IndianRupee className="h-6 w-6 text-teal-600 dark:text-teal-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-wallet-balance">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Wallet Balance</p>
                  <p className="text-2xl font-bold">{'\u20B9'}{Math.round(credits?.walletBalance || 0).toLocaleString()}</p>
                </div>
                <div className="p-3 bg-indigo-100 dark:bg-indigo-900 rounded-full">
                  <Wallet className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            <Dialog open={setWalletOpen} onOpenChange={setSetWalletOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" data-testid="button-set-wallet-total">
                  <Wallet className="w-4 h-4 mr-2" /> Set Wallet Total
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Set Wallet Total</DialogTitle>
                  <DialogDescription>Set the total project wallet amount (in rupees)</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="wallet-total">Wallet Total ({'\u20B9'})</Label>
                    <Input
                      id="wallet-total"
                      type="number"
                      value={walletTotal}
                      onChange={(e) => setWalletTotal(e.target.value)}
                      placeholder="Enter wallet total"
                      data-testid="input-wallet-total"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setSetWalletOpen(false)}>Cancel</Button>
                  <Button
                    onClick={() => setWalletTotalMutation.mutate()}
                    disabled={!walletTotal || parseFloat(walletTotal) < 0 || setWalletTotalMutation.isPending}
                    data-testid="button-confirm-set-wallet"
                  >
                    {setWalletTotalMutation.isPending ? "Saving..." : "Set Total"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={recordPaymentOpen} onOpenChange={setRecordPaymentOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" data-testid="button-record-payment">
                  <IndianRupee className="w-4 h-4 mr-2" /> Record Payment
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Record Payment</DialogTitle>
                  <DialogDescription>Record a wallet funding payment</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="payment-amount">Amount ({'\u20B9'})</Label>
                    <Input
                      id="payment-amount"
                      type="number"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      placeholder="Enter payment amount"
                      data-testid="input-payment-amount"
                    />
                  </div>
                  <div>
                    <Label htmlFor="payment-desc">Description</Label>
                    <Input
                      id="payment-desc"
                      value={paymentDescription}
                      onChange={(e) => setPaymentDescription(e.target.value)}
                      placeholder="e.g., Token advance, Milestone payment"
                      data-testid="input-payment-description"
                    />
                  </div>
                  <div>
                    <Label htmlFor="payment-ref">Payment Reference (Optional)</Label>
                    <Input
                      id="payment-ref"
                      value={paymentRef}
                      onChange={(e) => setPaymentRef(e.target.value)}
                      placeholder="e.g., Bank transfer ref, Cheque number"
                      data-testid="input-payment-ref"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRecordPaymentOpen(false)}>Cancel</Button>
                  <Button
                    onClick={() => recordPaymentMutation.mutate()}
                    disabled={!paymentAmount || !paymentDescription || parseFloat(paymentAmount) <= 0 || recordPaymentMutation.isPending}
                    data-testid="button-confirm-record-payment"
                  >
                    {recordPaymentMutation.isPending ? "Recording..." : "Record Payment"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}

        <div className="mb-6">
          <Dialog open={requestCreditsOpen} onOpenChange={setRequestCreditsOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-request-credits">
                <Plus className="w-4 h-4 mr-2" /> Request Credits
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Request Credits</DialogTitle>
                <DialogDescription>
                  Request credits for {project?.clientName}'s project
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="request-type">Request Type</Label>
                  <Select value={requestType} onValueChange={(val) => setRequestType(val as CreditRequestType)}>
                    <SelectTrigger data-testid="select-request-type">
                      <SelectValue placeholder="Select request type" />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(CREDIT_REQUEST_TYPES) as [CreditRequestType, typeof CREDIT_REQUEST_TYPES[CreditRequestType]][]).map(([key, info]) => (
                        <SelectItem key={key} value={key} data-testid={`option-request-type-${key}`}>
                          {info.label} ({Math.round(info.amount).toLocaleString()} Credits)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedRequestTypeInfo && (
                  <div>
                    <Label>Credits Amount</Label>
                    <Input
                      readOnly
                      value={`${Math.round(selectedRequestTypeInfo.amount).toLocaleString()} Credits`}
                      className="bg-muted"
                      data-testid="input-request-amount"
                    />
                  </div>
                )}
                {requestTypeError && (
                  <p className="text-sm text-red-600" data-testid="text-request-type-error">{requestTypeError}</p>
                )}
                <div>
                  <Label htmlFor="request-reference">Payment Reference (Optional)</Label>
                  <Input
                    id="request-reference"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    placeholder="e.g., Bank transfer ref, Cheque number"
                    data-testid="input-request-payment-reference"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setRequestCreditsOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => requestCreditsMutation.mutate()}
                  disabled={!requestType || !!requestTypeError || requestCreditsMutation.isPending}
                  data-testid="button-confirm-request-credits"
                >
                  {requestCreditsMutation.isPending ? "Submitting..." : "Submit Request"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Tabs defaultValue="milestones" className="w-full">
          <TabsList data-testid="tabs-credits">
            <TabsTrigger value="milestones" data-testid="tab-milestones">Milestones</TabsTrigger>
            <TabsTrigger value="transactions" data-testid="tab-transactions">Transaction History</TabsTrigger>
            <TabsTrigger value="credit-requests" data-testid="tab-credit-requests">Credit Requests</TabsTrigger>
            <TabsTrigger value="wallet-history" data-testid="tab-wallet-history">Wallet History</TabsTrigger>
          </TabsList>

          <TabsContent value="milestones">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle>Project Milestones</CardTitle>
                  <CardDescription>Track design milestones and credit consumption</CardDescription>
                </div>
                <Dialog open={createMilestoneOpen} onOpenChange={setCreateMilestoneOpen}>
                  <DialogTrigger asChild>
                    <Button data-testid="button-create-milestone">
                      <Plus className="w-4 h-4 mr-2" /> Create Milestone
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Create Milestone</DialogTitle>
                      <DialogDescription>
                        Create a new milestone for {project?.clientName}'s project
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="milestone-type">Milestone Type</Label>
                        <Select value={milestoneType} onValueChange={(val) => { setMilestoneType(val); setMilestoneRoomId(""); }}>
                          <SelectTrigger data-testid="select-milestone-type">
                            <SelectValue placeholder="Select milestone type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__mandatory_header" disabled>
                              Mandatory Milestones
                            </SelectItem>
                            {milestoneStages
                              .filter((stage) => stage.category === 'mandatory')
                              .map((stage) => {
                                const key = stage.key;
                                const isUsed = usedMandatoryTypes.includes(key);
                                return (
                                  <SelectItem
                                    key={key}
                                    value={key}
                                    disabled={isUsed}
                                    data-testid={`option-milestone-type-${key}`}
                                  >
                                    {stage.name} ({Math.round(stage.creditAmount).toLocaleString()} Credits){isUsed ? ' (Already used)' : ''}
                                  </SelectItem>
                                );
                              })}
                            <SelectItem value="__additional_header" disabled>
                              Additional Milestones
                            </SelectItem>
                            {milestoneStages
                              .filter((stage) => stage.category === 'additional')
                              .map((stage) => (
                                <SelectItem key={stage.key} value={stage.key} data-testid={`option-milestone-type-${stage.key}`}>
                                  {stage.name} ({Math.round(stage.creditAmount).toLocaleString()} Credits)
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {selectedMilestoneTypeInfo && (
                        <div>
                          <Label>Credit Amount</Label>
                          <Input
                            readOnly
                            value={`${Math.round(selectedMilestoneTypeInfo.creditAmount).toLocaleString()} Credits`}
                            className="bg-muted"
                            data-testid="input-milestone-amount"
                          />
                        </div>
                      )}
                      {isAdditionalMilestone && rooms.length > 0 && (
                        <div>
                          <Label htmlFor="milestone-room">Room (Optional)</Label>
                          <Select value={milestoneRoomId} onValueChange={setMilestoneRoomId}>
                            <SelectTrigger data-testid="select-milestone-room">
                              <SelectValue placeholder="Select a room" />
                            </SelectTrigger>
                            <SelectContent>
                              {rooms.map((room) => (
                                <SelectItem key={room.id} value={room.id} data-testid={`option-room-${room.id}`}>
                                  {room.roomName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <div>
                        <Label htmlFor="milestone-description">Description (Optional)</Label>
                        <Textarea
                          id="milestone-description"
                          value={milestoneDescription}
                          onChange={(e) => setMilestoneDescription(e.target.value)}
                          placeholder="Describe the milestone deliverables..."
                          data-testid="input-milestone-description"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setCreateMilestoneOpen(false)}>Cancel</Button>
                      <Button
                        onClick={() => createMilestoneMutation.mutate()}
                        disabled={!milestoneType || createMilestoneMutation.isPending}
                        data-testid="button-submit-milestone"
                      >
                        {createMilestoneMutation.isPending ? "Creating..." : "Create Milestone"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {milestones.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No milestones created yet. Click "Create Milestone" to add one.</p>
                ) : (
                  <div className="space-y-4">
                    {milestones.map((milestone) => (
                      <div key={milestone.id} className="flex items-center justify-between p-4 border rounded-md" data-testid={`milestone-${milestone.id}`}>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium">{milestone.name}</p>
                            {getStatusBadge(milestone.status)}
                          </div>
                          {milestone.description && (
                            <p className="text-sm text-muted-foreground mt-1">{milestone.description}</p>
                          )}
                          <p className="text-sm mt-1">
                            Credits: <span className="font-medium">{Math.round(milestone.creditAmount).toLocaleString()} Credits</span>
                          </p>
                          {milestone.revisionCount > 0 && (
                            <p className="text-xs text-muted-foreground">Revisions: {milestone.revisionCount}</p>
                          )}
                          {milestone.rejectionReason && (
                            <p className="text-sm text-red-600 mt-1">Rejected: {milestone.rejectionReason}</p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          {(milestone.status === 'pending' || milestone.status === 'rejected') && (
                            <Button
                              size="sm"
                              onClick={() => submitMilestoneMutation.mutate(milestone.id)}
                              disabled={submitMilestoneMutation.isPending}
                              data-testid={`button-submit-for-approval-${milestone.id}`}
                            >
                              <Check className="w-4 h-4 mr-1" />
                              {milestone.status === 'rejected' ? 'Resubmit' : 'Submit for Approval'}
                            </Button>
                          )}
                          {isAdmin && milestone.status === 'submitted' && (
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
                          )}
                          <div className="text-right text-sm text-muted-foreground">
                            {milestone.reviewedAt ? (
                              <p>Reviewed {formatDistanceToNow(new Date(milestone.reviewedAt), { addSuffix: true })}</p>
                            ) : milestone.submittedAt ? (
                              <p>Submitted {formatDistanceToNow(new Date(milestone.submittedAt), { addSuffix: true })}</p>
                            ) : (
                              <p>Created {formatDistanceToNow(new Date(milestone.createdAt), { addSuffix: true })}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="transactions">
            <Card>
              <CardHeader>
                <CardTitle>Transaction History</CardTitle>
                <CardDescription>All credit additions and deductions</CardDescription>
              </CardHeader>
              <CardContent>
                {transactions.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No transactions yet</p>
                ) : (
                  <div className="space-y-3">
                    {transactions.map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between p-3 border rounded-md" data-testid={`transaction-${tx.id}`}>
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-full ${tx.type === 'credit' ? 'bg-green-100 dark:bg-green-900' : 'bg-orange-100 dark:bg-orange-900'}`}>
                            {tx.type === 'credit' ? (
                              <TrendingUp className="w-4 h-4 text-green-600" />
                            ) : (
                              <TrendingDown className="w-4 h-4 text-orange-600" />
                            )}
                          </div>
                          <div>
                            <p className="font-medium">{tx.description}</p>
                            {tx.paymentReference && (
                              <p className="text-xs text-muted-foreground">Ref: {tx.paymentReference}</p>
                            )}
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(tx.createdAt), 'PPp')}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-medium ${tx.type === 'credit' ? 'text-green-600' : 'text-orange-600'}`}>
                            {tx.type === 'credit' ? '+' : '-'}{Math.round(tx.amount).toLocaleString()} Credits
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Balance: {Math.round(tx.balanceAfter).toLocaleString()} Credits
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="credit-requests">
            <Card>
              <CardHeader>
                <CardTitle>Credit Requests</CardTitle>
                <CardDescription>All credit requests for this project</CardDescription>
              </CardHeader>
              <CardContent>
                {creditRequests.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No credit requests yet</p>
                ) : (
                  <div className="space-y-4">
                    {creditRequests.map((cr) => {
                      const typeInfo = CREDIT_REQUEST_TYPES[cr.requestType as CreditRequestType];
                      return (
                        <div key={cr.id} className="flex items-center justify-between p-4 border rounded-md" data-testid={`credit-request-${cr.id}`}>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium">{typeInfo?.label || cr.requestType}</p>
                              {getStatusBadge(cr.status)}
                            </div>
                            <p className="text-sm mt-1">
                              Amount: <span className="font-medium">{Math.round(cr.amount).toLocaleString()} Credits</span>
                            </p>
                            {cr.paymentReference && (
                              <p className="text-xs text-muted-foreground">Ref: {cr.paymentReference}</p>
                            )}
                            {cr.rejectionReason && (
                              <p className="text-sm text-red-600 mt-1">Rejected: {cr.rejectionReason}</p>
                            )}
                            <p className="text-xs text-muted-foreground mt-1">
                              Requested {formatDistanceToNow(new Date(cr.createdAt), { addSuffix: true })}
                            </p>
                          </div>
                          {isAdmin && cr.status === 'pending' && (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={() => approveCreditRequestMutation.mutate(cr.id)}
                                disabled={approveCreditRequestMutation.isPending}
                                data-testid={`button-approve-credit-request-${cr.id}`}
                              >
                                <Check className="w-4 h-4 mr-1" /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => {
                                  setSelectedCreditRequest(cr);
                                  setRejectCreditRequestDialogOpen(true);
                                }}
                                data-testid={`button-reject-credit-request-${cr.id}`}
                              >
                                <X className="w-4 h-4 mr-1" /> Reject
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="wallet-history">
            <Card>
              <CardHeader>
                <CardTitle>Wallet Funding History</CardTitle>
                <CardDescription>All wallet funding entries for this project</CardDescription>
              </CardHeader>
              <CardContent>
                {walletEntries.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No wallet funding entries yet</p>
                ) : (
                  <div className="space-y-3">
                    {walletEntries.map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between p-3 border rounded-md" data-testid={`wallet-entry-${entry.id}`}>
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-full bg-green-100 dark:bg-green-900">
                            <IndianRupee className="w-4 h-4 text-green-600" />
                          </div>
                          <div>
                            <p className="font-medium">{entry.description}</p>
                            {entry.paymentReference && (
                              <p className="text-xs text-muted-foreground">Ref: {entry.paymentReference}</p>
                            )}
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(entry.createdAt), 'PPp')}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-medium text-green-600">
                            +{'\u20B9'}{Math.round(entry.amount).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
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

      <Dialog open={rejectCreditRequestDialogOpen} onOpenChange={setRejectCreditRequestDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Credit Request</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this credit request
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="credit-request-rejection-reason">Reason</Label>
            <Textarea
              id="credit-request-rejection-reason"
              value={creditRequestRejectionReason}
              onChange={(e) => setCreditRequestRejectionReason(e.target.value)}
              placeholder="Enter the reason for rejection..."
              data-testid="input-credit-request-rejection-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectCreditRequestDialogOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => rejectCreditRequestMutation.mutate()}
              disabled={!creditRequestRejectionReason || rejectCreditRequestMutation.isPending}
              data-testid="button-confirm-reject-credit-request"
            >
              Reject Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
