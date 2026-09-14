import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { format } from "date-fns";
import { AlertCircle, Wallet, TrendingUp, TrendingDown, Clock, Check, X, CreditCard, Receipt } from "lucide-react";

interface CreditsData {
  totalCredits: number;
  usedCredits: number;
  availableCredits: number;
}

interface WalletData {
  projectWallet: number;
  walletFunded: number;
  walletBalance: number;
}

interface PaymentScheduleData {
  grandTotal: number;
  tokenAdvance: number;
  preSignoff: number;
  designSignoff: number;
  materialDelivery: number;
  retention: number;
  total: number;
  tier: string;
}

interface MilestoneData {
  name: string;
  milestoneType?: string | null;
  creditAmount: number;
  status: string;
  description: string | null;
  createdAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
}

interface TransactionData {
  type: string;
  amount: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
}

interface CompanyData {
  appName?: string;
  companyName?: string;
  logoUrl?: string;
  phone?: string;
  email?: string;
  website?: string;
}

interface ClientCreditsResponse {
  clientName: string;
  projectType: string;
  pid?: string | null;
  credits: CreditsData;
  wallet: WalletData;
  paymentSchedule: PaymentScheduleData;
  milestones: MilestoneData[];
  transactions: TransactionData[];
  company: CompanyData | null;
}

export default function ClientCreditsPortal() {
  const [, params] = useRoute("/client/credits/:shareToken");
  const shareToken = params?.shareToken || "";

  const { data, isLoading, error } = useQuery<ClientCreditsResponse>({
    queryKey: ['/api/shared/credits', shareToken],
    queryFn: async () => {
      const res = await fetch(`/api/shared/credits/${shareToken}`);
      if (res.status === 410) {
        throw new Error("EXPIRED");
      }
      if (!res.ok) {
        throw new Error("NOT_FOUND");
      }
      return res.json();
    },
    enabled: !!shareToken,
    retry: false,
  });

  const formatCredits = (amount: number) => `${Math.round(amount).toLocaleString("en-IN")} Credits`;
  const formatCurrency = (amount: number) => `\u20B9${Math.round(amount).toLocaleString("en-IN")}`;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved":
        return <Badge variant="default" data-testid={`badge-status-${status}`}><Check className="h-3 w-3 mr-1" /> Approved</Badge>;
      case "submitted":
        return <Badge variant="secondary" data-testid={`badge-status-${status}`}><Clock className="h-3 w-3 mr-1" /> Submitted</Badge>;
      case "rejected":
        return <Badge variant="destructive" data-testid={`badge-status-${status}`}><X className="h-3 w-3 mr-1" /> Rejected</Badge>;
      default:
        return <Badge variant="outline" data-testid={`badge-status-${status}`}><Clock className="h-3 w-3 mr-1" /> Pending</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading credits portal...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    const errorMessage = (error as any)?.message || "";
    const isExpired = errorMessage === "EXPIRED";
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-error-title">
              {isExpired ? "Link Expired" : "Credits Portal Not Available"}
            </h2>
            <p className="text-muted-foreground" data-testid="text-error-message">
              {isExpired
                ? "This credits link has expired. Please contact your project manager for a new link."
                : "This credits link may be invalid or has been revoked. Please contact the person who shared this link with you."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { credits, wallet, paymentSchedule, milestones: milestonesList, transactions, company } = data;
  const creditUsagePercent = credits.totalCredits > 0 ? (credits.usedCredits / credits.totalCredits) * 100 : 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 md:px-6 h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            {company?.logoUrl && (
              <img
                src={company.logoUrl}
                alt={company.companyName || "Company Logo"}
                className="h-8 w-auto"
                data-testid="img-company-logo"
              />
            )}
            <div>
              <h1 className="text-lg font-semibold" data-testid="text-company-name">
                {company?.companyName || company?.appName || "Design Credits"}
              </h1>
            </div>
          </div>
          <Badge variant="outline" data-testid="badge-portal-label">
            <Wallet className="h-3 w-3 mr-1" /> Client Portal
          </Badge>
        </div>
      </header>

      <main className="container mx-auto px-4 md:px-6 py-6 max-w-4xl">
        <div className="mb-6">
          <h2 className="text-2xl font-bold" data-testid="text-client-name">{data.clientName}</h2>
          <p className="text-muted-foreground" data-testid="text-project-name">
            {data.projectType}{data.pid ? ` (${data.pid})` : ""}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-2">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Total Credits</span>
              </div>
              <p className="text-2xl font-bold" data-testid="text-total-credits">{formatCredits(credits.totalCredits)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Used Credits</span>
              </div>
              <p className="text-2xl font-bold" data-testid="text-used-credits">{formatCredits(credits.usedCredits)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Available Credits</span>
              </div>
              <p className="text-2xl font-bold text-primary" data-testid="text-available-credits">{formatCredits(credits.availableCredits)}</p>
            </CardContent>
          </Card>
        </div>

        {credits.totalCredits > 0 && (
          <Card className="mb-8">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Credit Usage</span>
                <span className="text-sm font-medium" data-testid="text-usage-percent">{creditUsagePercent.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-3">
                <div
                  className="bg-primary rounded-full h-3 transition-all duration-500"
                  style={{ width: `${Math.min(creditUsagePercent, 100)}%` }}
                  data-testid="progress-credit-usage"
                ></div>
              </div>
            </CardContent>
          </Card>
        )}

        {wallet && wallet.projectWallet > 0 && (
          <>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" data-testid="heading-wallet">
              <Wallet className="h-5 w-5" /> Project Wallet
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground mb-1">Project Value</p>
                  <p className="text-xl font-bold" data-testid="text-wallet-total">{formatCurrency(wallet.projectWallet)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground mb-1">Payments Received</p>
                  <p className="text-xl font-bold text-green-600" data-testid="text-wallet-funded">{formatCurrency(wallet.walletFunded)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground mb-1">Balance Due</p>
                  <p className="text-xl font-bold text-orange-600" data-testid="text-wallet-balance">{formatCurrency(wallet.walletBalance)}</p>
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {paymentSchedule && paymentSchedule.grandTotal > 0 && (
          <>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" data-testid="heading-payment-schedule">
              <Receipt className="h-5 w-5" /> Payment Schedule
            </h3>
            <Card className="mb-8">
              <CardContent className="pt-6">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="table-payment-schedule">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground">Payment Stage</th>
                        <th className="text-right py-2 px-3 font-medium text-muted-foreground">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b">
                        <td className="py-2 px-3">Onboarding Amount</td>
                        <td className="py-2 px-3 text-right font-mono">{formatCurrency(paymentSchedule.tokenAdvance)}</td>
                      </tr>
                      <tr className="border-b">
                        <td className="py-2 px-3">Pre Sign-off - 30%</td>
                        <td className="py-2 px-3 text-right font-mono">{formatCurrency(paymentSchedule.preSignoff)}</td>
                      </tr>
                      <tr className="border-b">
                        <td className="py-2 px-3">Design Sign Off - 30%</td>
                        <td className="py-2 px-3 text-right font-mono">{formatCurrency(paymentSchedule.designSignoff)}</td>
                      </tr>
                      <tr className="border-b">
                        <td className="py-2 px-3">Upon Modular Material Delivery - 40%</td>
                        <td className="py-2 px-3 text-right font-mono">{formatCurrency(paymentSchedule.materialDelivery)}</td>
                      </tr>
                      <tr className="border-b">
                        <td className="py-2 px-3">Retention Amount</td>
                        <td className="py-2 px-3 text-right font-mono">{formatCurrency(paymentSchedule.retention)}</td>
                      </tr>
                      <tr className="font-semibold">
                        <td className="py-2 px-3">Total</td>
                        <td className="py-2 px-3 text-right font-mono">{formatCurrency(paymentSchedule.total)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        <div className="space-y-8">
          <div>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" data-testid="heading-milestones">
              <Clock className="h-5 w-5" /> Milestone Progress
            </h3>
            {milestonesList.length === 0 ? (
              <Card>
                <CardContent className="pt-6 text-center text-muted-foreground" data-testid="text-no-milestones">
                  No milestones have been created yet.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {milestonesList.map((milestone, index) => (
                  <Card key={index} data-testid={`card-milestone-${index}`}>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-medium" data-testid={`text-milestone-name-${index}`}>{milestone.name}</h4>
                            {getStatusBadge(milestone.status)}
                          </div>
                          {milestone.description && (
                            <p className="text-sm text-muted-foreground mt-1" data-testid={`text-milestone-desc-${index}`}>
                              {milestone.description}
                            </p>
                          )}
                          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                            <span>Created: {format(new Date(milestone.createdAt), "MMM d, yyyy")}</span>
                            {milestone.submittedAt && (
                              <span>Submitted: {format(new Date(milestone.submittedAt), "MMM d, yyyy")}</span>
                            )}
                            {milestone.reviewedAt && (
                              <span>Reviewed: {format(new Date(milestone.reviewedAt), "MMM d, yyyy")}</span>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold" data-testid={`text-milestone-amount-${index}`}>
                            {formatCredits(milestone.creditAmount)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <Separator />

          <div>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" data-testid="heading-transactions">
              <CreditCard className="h-5 w-5" /> Transaction History
            </h3>
            {transactions.length === 0 ? (
              <Card>
                <CardContent className="pt-6 text-center text-muted-foreground" data-testid="text-no-transactions">
                  No transactions recorded yet.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {transactions.map((transaction, index) => (
                  <Card key={index} data-testid={`card-transaction-${index}`}>
                    <CardContent className="pt-3 pb-3">
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className={`p-2 rounded-full ${
                            transaction.type === 'credit' ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'
                          }`}>
                            {transaction.type === 'credit' ? (
                              <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
                            ) : (
                              <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate" data-testid={`text-transaction-desc-${index}`}>
                              {transaction.description}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(transaction.createdAt), "MMM d, yyyy 'at' h:mm a")}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-semibold ${
                            transaction.type === 'credit' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                          }`} data-testid={`text-transaction-amount-${index}`}>
                            {transaction.type === 'credit' ? '+' : '-'}{formatCredits(transaction.amount)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Balance: {formatCredits(transaction.balanceAfter)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-12 pt-6 border-t text-center text-xs text-muted-foreground">
          {company?.companyName && <p>{company.companyName}</p>}
          <div className="flex items-center justify-center gap-4 mt-1 flex-wrap">
            {company?.phone && <span>{company.phone}</span>}
            {company?.email && <span>{company.email}</span>}
            {company?.website && <span>{company.website}</span>}
          </div>
        </div>
      </main>
    </div>
  );
}
