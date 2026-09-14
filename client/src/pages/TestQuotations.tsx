import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileSpreadsheet, CheckCircle, AlertCircle, PlayCircle, FolderPlus } from "lucide-react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface GQSheetData {
  sheetName: string;
  headers: string[];
  data: string[][];
  rawData: string[][];
  totalRows: number;
}

interface ComparisonResult {
  gqQuotation: any;
  softwareQuotation: any;
  differences: Array<{
    type: string;
    location: string;
    field: string;
    gqValue: number;
    softwareValue: number;
    difference: number;
    withinTolerance: boolean;
    toleranceStatus: 'match' | 'minor_rounding' | 'discrepancy';
  }>;
  matchSummary: {
    totalLineItems: number;
    matchingLineItems: number;
    minorRoundingItems: number;
    discrepancies: number;
    subtotalMatch: boolean;
    markupMatch: boolean;
    gstMatch: boolean;
    grandTotalMatch: boolean;
  };
}

interface CreateProjectResult {
  projectId: string;
  rooms: { roomId: string; name: string; lineItemCount: number }[];
  totals: { subtotal: number; markupPercentage: number; markupValue: number; gstPercentage: number; gstAmount: number; grandTotal: number };
  gqTotals: { subtotal: number; markupPercentage: number; markupValue: number; gstPercentage: number; gstAmount: number; grandTotal: number };
}

export default function TestQuotations() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [selectedSheet, setSelectedSheet] = useState<string>("Xpress - GQ- 1");
  const [shouldFetch, setShouldFetch] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);
  const [createdProject, setCreatedProject] = useState<CreateProjectResult | null>(null);

  const { data: gqData, isLoading, error, refetch } = useQuery<GQSheetData>({
    queryKey: ['/api/quotations/gq', selectedSheet],
    enabled: shouldFetch,
  });

  const testMutation = useMutation({
    mutationFn: async (sheetName: string) => {
      const res = await apiRequest('POST', '/api/quotations/test', { sheetName });
      return res.json();
    },
    onSuccess: (data: ComparisonResult) => {
      setComparisonResult(data);
      toast({
        title: "Comparison Complete",
        description: `Found ${data.matchSummary.discrepancies} discrepancies`,
        variant: data.matchSummary.discrepancies === 0 ? "default" : "destructive",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Test Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const createProjectMutation = useMutation({
    mutationFn: async (sheetName: string) => {
      const res = await apiRequest('POST', '/api/quotations/create-from-gq', { sheetName });
      return res.json() as Promise<CreateProjectResult>;
    },
    onSuccess: (data: CreateProjectResult) => {
      setCreatedProject(data);
      toast({
        title: "Reference Project Created",
        description: `Created project with ${data.rooms.length} rooms. Click "View Project" to see it.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Creation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFetch = () => {
    setShouldFetch(true);
    refetch();
  };

  const handleRunTest = () => {
    testMutation.mutate(selectedSheet);
  };

  const handleCreateProject = () => {
    setCreatedProject(null);
    createProjectMutation.mutate(selectedSheet);
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Test Quotations</h1>
        <p className="text-muted-foreground">
          Compare manual Google Sheets quotations (GQ 1-4) against software-generated calculations
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Select GQ Sheet
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">
                Quotation Sheet
              </label>
              <Select value={selectedSheet} onValueChange={setSelectedSheet}>
                <SelectTrigger data-testid="select-gq-sheet">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Xpress - GQ- 1">DeX Xpress - GQ-1 (Primary)</SelectItem>
                  <SelectItem value="Xpand - GQ- 1">DeX Xpand - GQ-1 (Primary)</SelectItem>
                  <SelectItem value="GQ 1">Legacy GQ 1</SelectItem>
                  <SelectItem value="GQ 2">Legacy GQ 2</SelectItem>
                  <SelectItem value="GQ 3">Legacy GQ 3</SelectItem>
                  <SelectItem value="GQ 4">Legacy GQ 4</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex gap-2 flex-wrap">
              <Button 
                onClick={handleFetch} 
                disabled={isLoading}
                variant="outline"
                data-testid="button-fetch-gq"
              >
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                View Sheet Data
              </Button>
              
              <Button 
                onClick={handleRunTest} 
                disabled={testMutation.isPending}
                data-testid="button-run-test"
              >
                {testMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <PlayCircle className={`${testMutation.isPending ? 'hidden' : ''} mr-2 h-4 w-4`} />
                Run Comparison Test
              </Button>
              
              <Button 
                onClick={handleCreateProject} 
                disabled={createProjectMutation.isPending}
                variant="secondary"
                data-testid="button-create-project"
              >
                {createProjectMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <FolderPlus className={`${createProjectMutation.isPending ? 'hidden' : ''} mr-2 h-4 w-4`} />
                Create Reference Project
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>
            {error instanceof Error ? error.message : "Failed to fetch GQ sheet"}
          </AlertDescription>
        </Alert>
      )}

      {createdProject && (
        <Card className="mb-6 border-green-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              Reference Project Created Successfully
            </CardTitle>
            <CardDescription>
              Project with {createdProject.rooms.length} rooms and{' '}
              {createdProject.rooms.reduce((sum, r) => sum + r.lineItemCount, 0)} line items created from {selectedSheet}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="border rounded-md p-3">
                <p className="text-xs text-muted-foreground mb-1">Software Subtotal</p>
                <p className="font-mono font-semibold">₹{createdProject.totals.subtotal.toLocaleString('en-IN')}</p>
              </div>
              <div className="border rounded-md p-3">
                <p className="text-xs text-muted-foreground mb-1">GQ Subtotal</p>
                <p className="font-mono font-semibold">₹{createdProject.gqTotals.subtotal.toLocaleString('en-IN')}</p>
              </div>
              <div className="border rounded-md p-3">
                <p className="text-xs text-muted-foreground mb-1">Software Grand Total</p>
                <p className="font-mono font-semibold">₹{createdProject.totals.grandTotal.toLocaleString('en-IN')}</p>
              </div>
              <div className="border rounded-md p-3">
                <p className="text-xs text-muted-foreground mb-1">GQ Grand Total</p>
                <p className="font-mono font-semibold">₹{createdProject.gqTotals.grandTotal.toLocaleString('en-IN')}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button 
                onClick={() => navigate(`/project/${createdProject.projectId}`)}
                data-testid="button-view-project"
              >
                View Project
              </Button>
              <Button 
                variant="outline" 
                onClick={() => navigate('/')}
                data-testid="button-go-dashboard"
              >
                Go to Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {comparisonResult && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {comparisonResult.matchSummary.discrepancies === 0 && comparisonResult.matchSummary.minorRoundingItems === 0 ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  All Calculations Match!
                </>
              ) : (
                <>
                  {comparisonResult.matchSummary.discrepancies > 0 ? (
                    <AlertCircle className="h-5 w-5 text-destructive" />
                  ) : (
                    <CheckCircle className="h-5 w-5 text-green-600" />
                  )}
                  {comparisonResult.matchSummary.matchingLineItems} Match, {comparisonResult.matchSummary.minorRoundingItems} Minor Rounding, {comparisonResult.matchSummary.discrepancies} Discrepancies
                </>
              )}
            </CardTitle>
            <CardDescription>
              {comparisonResult.matchSummary.totalLineItems} line items analyzed
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="border rounded-md p-3">
                  <p className="text-xs text-muted-foreground mb-1">Subtotal</p>
                  <Badge variant={comparisonResult.matchSummary.subtotalMatch ? "default" : "destructive"}>
                    {comparisonResult.matchSummary.subtotalMatch ? "Match" : "Mismatch"}
                  </Badge>
                </div>
                <div className="border rounded-md p-3">
                  <p className="text-xs text-muted-foreground mb-1">Enablement Fee</p>
                  <Badge variant={comparisonResult.matchSummary.markupMatch ? "default" : "destructive"}>
                    {comparisonResult.matchSummary.markupMatch ? "Match" : "Mismatch"}
                  </Badge>
                </div>
                <div className="border rounded-md p-3">
                  <p className="text-xs text-muted-foreground mb-1">GST</p>
                  <Badge variant={comparisonResult.matchSummary.gstMatch ? "default" : "destructive"}>
                    {comparisonResult.matchSummary.gstMatch ? "Match" : "Mismatch"}
                  </Badge>
                </div>
                <div className="border rounded-md p-3">
                  <p className="text-xs text-muted-foreground mb-1">Grand Total</p>
                  <Badge variant={comparisonResult.matchSummary.grandTotalMatch ? "default" : "destructive"}>
                    {comparisonResult.matchSummary.grandTotalMatch ? "Match" : "Mismatch"}
                  </Badge>
                </div>
              </div>

              {/* Tolerance Explanation */}
              <div className="border rounded-md p-4 bg-muted/50">
                <h4 className="text-sm font-semibold mb-2">Tolerance Levels</h4>
                <div className="text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="text-xs">Match (±₹0.50)</Badge>
                    <span className="text-muted-foreground">Exact match - Project totals must meet this strict tolerance</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">Minor Rounding (±₹10)</Badge>
                    <span className="text-muted-foreground">Acceptable manual adjustments - Common in line items for client-friendly pricing</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="destructive" className="text-xs">Discrepancy (&gt;₹10)</Badge>
                    <span className="text-muted-foreground">Needs investigation - Significant calculation difference</span>
                  </div>
                </div>
              </div>

              {/* Differences Table */}
              {comparisonResult.differences.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">Detailed Discrepancies:</h3>
                  <div className="border rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted">
                        <tr>
                          <th className="px-3 py-2 text-left">Type</th>
                          <th className="px-3 py-2 text-left">Location</th>
                          <th className="px-3 py-2 text-right">GQ Value</th>
                          <th className="px-3 py-2 text-right">Software Value</th>
                          <th className="px-3 py-2 text-right">Difference</th>
                          <th className="px-3 py-2 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparisonResult.differences.map((diff, idx) => (
                          <tr key={idx} className="border-t">
                            <td className="px-3 py-2">
                              <Badge variant="outline">{diff.type.replace('_', ' ')}</Badge>
                            </td>
                            <td className="px-3 py-2">{diff.location}</td>
                            <td className="px-3 py-2 text-right font-mono">₹{diff.gqValue.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right font-mono">₹{diff.softwareValue.toFixed(2)}</td>
                            <td className={`px-3 py-2 text-right font-mono ${diff.difference > 0 ? 'text-red-600' : 'text-green-600'}`}>
                              {diff.difference > 0 ? '+' : ''}₹{diff.difference.toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {diff.toleranceStatus === 'match' && (
                                <Badge variant="default" className="text-xs">
                                  Match (±₹0.50)
                                </Badge>
                              )}
                              {diff.toleranceStatus === 'minor_rounding' && (
                                <Badge variant="secondary" className="text-xs">
                                  Minor Rounding (±₹10)
                                </Badge>
                              )}
                              {diff.toleranceStatus === 'discrepancy' && (
                                <Badge variant="destructive" className="text-xs">
                                  Discrepancy (&gt;₹10)
                                </Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {gqData && (
        <Card>
          <CardHeader>
            <CardTitle>Sheet Data: {gqData.sheetName}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">Total Rows: {gqData.totalRows}</p>
                <p className="text-sm font-medium">Headers: {gqData.headers?.length || 0} columns</p>
              </div>

              {gqData.headers && gqData.headers.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">Column Headers:</h3>
                  <div className="bg-muted p-3 rounded-md overflow-x-auto">
                    <code className="text-xs whitespace-pre">
                      {gqData.headers.map((header: string, idx: number) => 
                        `[${idx}] ${header}`
                      ).join('\n')}
                    </code>
                  </div>
                </div>
              )}

              {gqData.data && gqData.data.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">Sample Data (first 10 rows):</h3>
                  <div className="bg-muted p-3 rounded-md overflow-x-auto max-h-96">
                    <table className="text-xs font-mono">
                      <thead>
                        <tr className="border-b border-border">
                          {gqData.headers?.map((header: string, idx: number) => (
                            <th key={idx} className="px-2 py-1 text-left font-semibold">
                              {header || `Col ${idx}`}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {gqData.data.slice(0, 10).map((row: string[], rowIdx: number) => (
                          <tr key={rowIdx} className="border-b border-border/50">
                            {row.map((cell: string, cellIdx: number) => (
                              <td key={cellIdx} className="px-2 py-1">
                                {cell || <span className="text-muted-foreground italic">(empty)</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-sm font-semibold mb-2">Raw JSON:</h3>
                <div className="bg-muted p-3 rounded-md overflow-x-auto max-h-96">
                  <pre className="text-xs">
                    {JSON.stringify(gqData, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
