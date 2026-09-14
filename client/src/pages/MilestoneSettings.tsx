import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Loader2, Plus, Save, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type MilestoneStage = {
  id: string;
  key: string;
  name: string;
  creditAmount: number;
  category: "mandatory" | "additional";
};

export default function MilestoneSettings() {
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [newCreditAmount, setNewCreditAmount] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingCreditAmount, setEditingCreditAmount] = useState("");

  const { data: stages = [], isLoading } = useQuery<MilestoneStage[]>({
    queryKey: ["/api/admin/milestone-stages"],
  });

  const createStage = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/admin/milestone-stages", {
        name: newName,
        creditAmount: Number(newCreditAmount),
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/milestone-stages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/milestone-stages"] });
      setNewName("");
      setNewCreditAmount("");
      toast({ title: "Milestone stage added", description: "It is now available for future project milestones." });
    },
    onError: (error: Error) => toast({ title: "Stage not added", description: error.message, variant: "destructive" }),
  });

  const updateStage = useMutation({
    mutationFn: async (stageId: string) => {
      const response = await apiRequest("PATCH", `/api/admin/milestone-stages/${stageId}`, {
        name: editingName,
        creditAmount: Number(editingCreditAmount),
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/milestone-stages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/milestone-stages"] });
      setEditingId(null);
      toast({ title: "Milestone stage updated", description: "The change applies to future milestones only." });
    },
    onError: (error: Error) => toast({ title: "Stage not updated", description: error.message, variant: "destructive" }),
  });

  const startEditing = (stage: MilestoneStage) => {
    setEditingId(stage.id);
    setEditingName(stage.name);
    setEditingCreditAmount(String(stage.creditAmount));
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            <Link href="/admin"><Button variant="ghost" size="icon" data-testid="button-back-admin"><ArrowLeft className="h-5 w-5" /></Button></Link>
            <div>
              <h1 className="text-xl font-semibold">Milestone Settings</h1>
              <p className="text-xs text-muted-foreground">Credit System configuration</p>
            </div>
          </div>
          <Link href="/admin/credits"><Button variant="outline" size="sm">Credit Dashboard</Button></Link>
        </div>
      </header>

      <main className="container mx-auto max-w-4xl space-y-6 px-4 py-8 md:px-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> Add Milestone Stage</CardTitle>
            <CardDescription>
              New stages are available as additional project milestones. Existing stage names and credit amounts can be edited below.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-[1fr_220px_auto] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="new-stage-name">Stage name</Label>
              <Input id="new-stage-name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. Client Presentation" data-testid="input-new-milestone-stage-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-stage-credits">Credit points</Label>
              <Input id="new-stage-credits" type="number" min="0" step="1" value={newCreditAmount} onChange={(event) => setNewCreditAmount(event.target.value)} placeholder="e.g. 100" data-testid="input-new-milestone-stage-credits" />
            </div>
            <Button onClick={() => createStage.mutate()} disabled={!newName.trim() || newCreditAmount === "" || Number(newCreditAmount) < 0 || createStage.isPending} data-testid="button-add-milestone-stage">
              {createStage.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Add Stage
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Settings2 className="h-5 w-5" /> Configured Stages</CardTitle>
            <CardDescription>
              Changes apply to future milestones only. Existing project milestones keep their original stage name and credit amount.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? <div className="py-8 text-center text-muted-foreground">Loading stages…</div> : stages.map((stage) => (
              <div key={stage.id} className="rounded-lg border p-4" data-testid={`milestone-stage-${stage.id}`}>
                {editingId === stage.id ? (
                  <div className="grid gap-3 md:grid-cols-[1fr_180px_auto] md:items-end">
                    <div className="space-y-2">
                      <Label htmlFor={`stage-name-${stage.id}`}>Stage name</Label>
                      <Input id={`stage-name-${stage.id}`} value={editingName} onChange={(event) => setEditingName(event.target.value)} data-testid={`input-stage-name-${stage.id}`} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`stage-credits-${stage.id}`}>Credit points</Label>
                      <Input id={`stage-credits-${stage.id}`} type="number" min="0" step="1" value={editingCreditAmount} onChange={(event) => setEditingCreditAmount(event.target.value)} data-testid={`input-stage-credits-${stage.id}`} />
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => updateStage.mutate(stage.id)} disabled={!editingName.trim() || editingCreditAmount === "" || Number(editingCreditAmount) < 0 || updateStage.isPending} data-testid={`button-save-stage-${stage.id}`}>
                        {updateStage.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{stage.name}</p>
                        <Badge variant="secondary">{stage.category === "mandatory" ? "Mandatory" : "Additional"}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{Math.round(stage.creditAmount).toLocaleString()} credit points</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => startEditing(stage)} data-testid={`button-edit-stage-${stage.id}`}>Edit</Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}