import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { ArrowLeft, Clock, Copy, FileText, FolderOpen, MoreVertical, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { LineItem, Project } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { normalizePid } from "@/lib/project-folders";

function projectVariant(project: Project): string {
  if (project.multiStyleEnabled) return "MSP";
  return (project.defaultCategory || "").replace(/^DeX - /, "");
}

export default function ProjectFolder() {
  const [, params] = useRoute("/folder/:pid");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const pid = decodeURIComponent(params?.pid || "").trim();
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  const folderProjects = useMemo(
    () => projects
      .filter(project => normalizePid(project.pid) === normalizePid(pid))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [projects, pid],
  );

  const { data: allLineItems = [] } = useQuery<LineItem[]>({
    queryKey: ["/api/line-items/all"],
    enabled: folderProjects.length > 0,
  });

  const duplicateMutation = useMutation({
    mutationFn: async (projectId: string) => {
      const response = await apiRequest("POST", `/api/projects/${projectId}/duplicate`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/line-items/all"] });
      toast({ title: "Success", description: "Quote duplicated in this PID folder" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (projectId: string) => {
      await apiRequest("DELETE", `/api/projects/${projectId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/line-items/all"] });
      setProjectToDelete(null);
      toast({ title: "Success", description: "Quote deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading folder...</div>;
  }

  const clientNames = Array.from(new Set(folderProjects.map(project => project.clientName)));

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-4 md:px-6 h-16 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/")} data-testid="button-back-dashboard">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <FolderOpen className="h-6 w-6 text-primary" />
          <div className="min-w-0">
            <h1 className="font-semibold truncate">{clientNames.join(", ") || "Project Folder"}</h1>
            <p className="text-xs text-muted-foreground font-mono">PID: {pid}</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 md:px-6 py-8">
        <div className="mb-6">
          <h2 className="text-2xl font-semibold">Quotes in this folder</h2>
          <p className="text-muted-foreground">
            {folderProjects.length} {folderProjects.length === 1 ? "quote" : "quotes"} share this PID.
          </p>
        </div>

        {folderProjects.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No accessible projects were found for PID {pid}.</p>
              <Button className="mt-4" onClick={() => setLocation("/")}>Back to Projects</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {folderProjects.map(project => {
              const lineItemCount = allLineItems.filter(item => item.projectId === project.id).length;
              return (
                <Card
                  key={project.id}
                  className="hover-elevate cursor-pointer group"
                  onClick={() => setLocation(`/project/${project.id}`)}
                  data-testid={`card-folder-quote-${project.id}`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-semibold truncate">{project.clientName}</h3>
                        <p className="text-sm text-muted-foreground">{project.projectType}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={project.status === "Generated" ? "default" : "secondary"}>
                          {project.status}
                        </Badge>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={event => event.stopPropagation()}>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={event => {
                                event.stopPropagation();
                                duplicateMutation.mutate(project.id);
                              }}
                            >
                              <Copy className="h-4 w-4 mr-2" />
                              Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={event => {
                                event.stopPropagation();
                                setProjectToDelete(project.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline">{projectVariant(project)}</Badge>
                      <span className="flex items-center gap-1 text-sm text-muted-foreground">
                        <FileText className="h-4 w-4" />
                        {lineItemCount} {lineItemCount === 1 ? "line item" : "line items"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      Updated {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      <AlertDialog open={Boolean(projectToDelete)} onOpenChange={open => !open && setProjectToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Quote</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes this quote, including its rooms and line items. Other quotes in the PID folder are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => projectToDelete && deleteMutation.mutate(projectToDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}