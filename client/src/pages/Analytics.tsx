import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocation } from "wouter";
import { ArrowLeft, FileText, TrendingUp, BarChart3, IndianRupee } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

interface QuoteAnalytics {
  totalQuotes: number;
  totalQuoteValue: number;
  countByStatus: Record<string, number>;
  valueByStatus: Record<string, number>;
  monthlyTrends: Array<{ month: string; count: number; value: number }>;
  averageQuoteValue: number;
}

const STATUS_COLORS: Record<string, string> = {
  Draft: "#94a3b8",
  Generated: "#22c55e",
  Sent: "#3b82f6",
  Accepted: "#10b981",
  Rejected: "#ef4444",
};

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
};

const formatMonth = (monthKey: string) => {
  const [year, month] = monthKey.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
};

export default function Analytics() {
  const [, setLocation] = useLocation();
  
  const { data: analytics, isLoading, error } = useQuery<QuoteAnalytics>({
    queryKey: ["/api/analytics/quotes"],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading analytics...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-destructive">Failed to load analytics</div>
      </div>
    );
  }

  const statusData = Object.entries(analytics?.countByStatus || {}).map(([status, count]) => ({
    name: status,
    value: count,
    color: STATUS_COLORS[status] || "#6b7280",
  }));

  const monthlyData = (analytics?.monthlyTrends || []).map((item) => ({
    ...item,
    monthLabel: formatMonth(item.month),
  }));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Quote Analytics</h1>
            <p className="text-sm text-muted-foreground">Track your quotation activity</p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <Card data-testid="card-total-quotes">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                Total Quotes
              </CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground hidden sm:block" />
            </CardHeader>
            <CardContent className="pt-0 sm:pt-0">
              <div className="text-xl sm:text-2xl font-bold" data-testid="text-total-quotes">
                {analytics?.totalQuotes || 0}
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-total-value">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                Total Value
              </CardTitle>
              <IndianRupee className="h-4 w-4 text-muted-foreground hidden sm:block" />
            </CardHeader>
            <CardContent className="pt-0 sm:pt-0">
              <div className="text-lg sm:text-2xl font-bold" data-testid="text-total-value">
                {formatCurrency(analytics?.totalQuoteValue || 0)}
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-average-value">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                Avg Value
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground hidden sm:block" />
            </CardHeader>
            <CardContent className="pt-0 sm:pt-0">
              <div className="text-lg sm:text-2xl font-bold" data-testid="text-average-value">
                {formatCurrency(analytics?.averageQuoteValue || 0)}
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-generated-count">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                Finalized
              </CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground hidden sm:block" />
            </CardHeader>
            <CardContent className="pt-0 sm:pt-0">
              <div className="text-xl sm:text-2xl font-bold" data-testid="text-generated-count">
                {analytics?.countByStatus?.Generated || 0}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card data-testid="card-status-breakdown">
            <CardHeader>
              <CardTitle>Quote Status Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {statusData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={statusData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {statusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Legend />
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  No quote data available
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-monthly-trends">
            <CardHeader>
              <CardTitle>Monthly Quote Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {monthlyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="monthLabel" className="text-xs" />
                    <YAxis yAxisId="left" orientation="left" className="text-xs" />
                    <YAxis yAxisId="right" orientation="right" className="text-xs" />
                    <Tooltip
                      formatter={(value: number, name: string) => {
                        if (name === "value") return [formatCurrency(value), "Value"];
                        return [value, "Count"];
                      }}
                    />
                    <Bar yAxisId="left" dataKey="count" fill="#3b82f6" name="count" radius={[4, 4, 0, 0]} />
                    <Legend />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  No monthly data available
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card data-testid="card-value-by-status">
          <CardHeader>
            <CardTitle>Quote Value by Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(analytics?.valueByStatus || {}).map(([status, value]) => (
                <div key={status} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: STATUS_COLORS[status] || "#6b7280" }}
                    />
                    <span className="font-medium">{status}</span>
                  </div>
                  <span className="text-muted-foreground" data-testid={`text-value-${status.toLowerCase()}`}>
                    {formatCurrency(value)}
                  </span>
                </div>
              ))}
              {Object.keys(analytics?.valueByStatus || {}).length === 0 && (
                <div className="text-center text-muted-foreground py-8">
                  No quote data available
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
