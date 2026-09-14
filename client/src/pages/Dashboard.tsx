import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, RefreshCw, Settings, Search, Copy, Trash2, MoreVertical, BarChart3 } from "lucide-react";
import dexLogo from "@/assets/dex-logo.png";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, FileText } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import CreateProjectDialog from "@/components/CreateProjectDialog";
import type { ProjectFormData } from "@/components/CreateProjectDialog";
import ThemeToggle from "@/components/ThemeToggle";
import UserMenu from "@/components/UserMenu";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Project, LineItem } from "@/lib/types";
import { refreshCatalog } from "@/lib/api";
import type { CompanySettings } from "@shared/schema";

interface CrmPrefill {
  clientName?: string;
  pid?: string;
  projectType?: "Residential" | "Commercial" | "Others";
  scope?: string;
  location?: string;
  estimatedValue?: string;
  leadId?: string;
}

const PROJECT_TYPE_VALUES = new Set(["Residential", "Commercial", "Others"]);

export default function Dashboard() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [crmPrefill, setCrmPrefill] = useState<CrmPrefill | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ['/api/projects'],
  });

  // CRM deep link: the Tele-CRM Tool opens this app with query params. If `pid`
  // matches an existing project, go straight there; otherwise prefill the
  // "Create New Project" dialog. Runs once, after the project list has loaded.
  const handledCrmLinkRef = useRef(false);
  useEffect(() => {
    if (handledCrmLinkRef.current || isLoading) return;

    const params = new URLSearchParams(window.location.search);
    const hasAnyParam = ["clientName", "pid", "projectType", "scope", "location", "estimatedValue", "leadId"]
      .some((key) => params.has(key));
    if (!hasAnyParam) {
      handledCrmLinkRef.current = true;
      return;
    }

    handledCrmLinkRef.current = true;

    const pid = params.get("pid") || undefined;
    const matchingProject = pid ? projects.find((p) => p.pid === pid) : undefined;

    // Clear the consumed query params so a refresh doesn't repeat this.
    const cleanUrl = window.location.pathname + window.location.hash;
    window.history.replaceState(null, "", cleanUrl);

    if (matchingProject) {
      setLocation(`/project/${matchingProject.id}`);
      return;
    }

    const projectTypeParam = params.get("projectType") || undefined;
    setCrmPrefill({
      clientName: params.get("clientName") || undefined,
      pid,
      projectType: projectTypeParam && PROJECT_TYPE_VALUES.has(projectTypeParam)
        ? (projectTypeParam as CrmPrefill["projectType"])
        : undefined,
      scope: params.get("scope") || undefined,
      location: params.get("location") || undefined,
      estimatedValue: params.get("estimatedValue") || undefined,
      leadId: params.get("leadId") || undefined,
    });
    setCreateDialogOpen(true);
  }, [isLoading, projects, setLocation]);

  const { data: allLineItems = [] } = useQuery<LineItem[]>({
    queryKey: ['/api/line-items/all'],
    enabled: projects.length > 0,
  });

  const { data: companySettings } = useQuery<CompanySettings>({
    queryKey: ['/api/company-settings/public'],
  });

  const appName = companySettings?.appName || "Quote Builder";

  const createProjectMutation = useMutation({
    mutationFn: async (data: ProjectFormData) => {
      const res = await apiRequest('POST', '/api/projects', {
        clientId: data.clientId,
        clientName: data.clientName,
        pid: data.pid,
        projectType: data.projectType,
        defaultCategory: data.category,
        multiStyleEnabled: data.multiStyleEnabled,
        // Carried through from a CRM deep link, if this project was created from one.
        // These have no dedicated dialog fields yet.
        scope: crmPrefill?.scope,
        location: crmPrefill?.location,
        estimatedValue: crmPrefill?.estimatedValue,
        leadId: crmPrefill?.leadId,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects'] });
      toast({
        title: "Success",
        description: "Project created successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create project",
        variant: "destructive",
      });
    },
  });

  const duplicateProjectMutation = useMutation({
    mutationFn: async (projectId: string) => {
      const res = await apiRequest('POST', `/api/projects/${projectId}/duplicate`);
      return res.json();
    },
    onSuccess: (newProject) => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects'] });
      queryClient.invalidateQueries({ queryKey: ['/api/line-items/all'] });
      toast({
        title: "Success",
        description: "Project duplicated successfully",
      });
      setLocation(`/project/${newProject.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to duplicate project",
        variant: "destructive",
      });
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async (projectId: string) => {
      await apiRequest('DELETE', `/api/projects/${projectId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects'] });
      queryClient.invalidateQueries({ queryKey: ['/api/line-items/all'] });
      toast({
        title: "Success",
        description: "Project deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete project",
        variant: "destructive",
      });
    },
  });

  const refreshCatalogMutation = useMutation({
    mutationFn: refreshCatalog,
    onSuccess: (data) => {
      toast({
        title: "Success",
        description: `Catalog refreshed successfully. ${data.itemCount} items loaded.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to refresh catalog",
        variant: "destructive",
      });
    },
  });

  const handleCreateProject = (data: ProjectFormData) => {
    createProjectMutation.mutate(data);
    setCrmPrefill(null);
  };

  const handleCreateDialogOpenChange = (open: boolean) => {
    setCreateDialogOpen(open);
    if (!open) {
      setCrmPrefill(null);
    }
  };

  const handleRefreshCatalog = () => {
    refreshCatalogMutation.mutate();
  };

  const handleDuplicateProject = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    duplicateProjectMutation.mutate(projectId);
  };

  const handleDeleteProject = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    setProjectToDelete(projectId);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (projectToDelete) {
      deleteProjectMutation.mutate(projectToDelete);
      setDeleteDialogOpen(false);
      setProjectToDelete(null);
    }
  };

  const projectsWithCounts = useMemo(() => {
    return projects.map(project => {
      const lineItemCount = allLineItems.filter(item => item.projectId === project.id).length;
      return {
        ...project,
        totalQuotes: lineItemCount,
      };
    });
  }, [projects, allLineItems]);

  const filteredProjects = useMemo(() => {
    return projectsWithCounts.filter(project => {
      const matchesSearch = searchQuery === "" || 
        project.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        project.projectType.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (project.pid && project.pid.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesStatus = statusFilter === "all" || project.status === statusFilter;
      
      return matchesSearch && matchesStatus;
    });
  }, [projectsWithCounts, searchQuery, statusFilter]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={dexLogo} alt="DEX Logo" className="h-10 w-10 rounded-full" data-testid="img-company-logo" />
            <h1 className="text-xl font-semibold" data-testid="text-app-title">{appName}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/analytics">
              <Button 
                variant="outline" 
                data-testid="button-analytics"
              >
                <BarChart3 className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Analytics</span>
              </Button>
            </Link>
            {(user?.role === "admin" || user?.role === "super_admin") && (
              <Link href="/admin">
                <Button 
                  variant="outline" 
                  data-testid="button-admin-dashboard"
                >
                  <Settings className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Admin</span>
                </Button>
              </Link>
            )}
            <Button 
              variant="outline" 
              onClick={handleRefreshCatalog}
              disabled={refreshCatalogMutation.isPending}
              data-testid="button-refresh-catalog"
              className="hidden md:inline-flex"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshCatalogMutation.isPending ? 'animate-spin' : ''}`} />
              Refresh Catalog
            </Button>
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 md:px-6 py-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h2 className="text-3xl font-semibold mb-2">Projects</h2>
            <p className="text-muted-foreground">
              Manage your quotations and create new projects
            </p>
          </div>
          <Button onClick={() => setCreateDialogOpen(true)} data-testid="button-create-project">
            <Plus className="h-4 w-4 mr-2" />
            New Project
          </Button>
        </div>

        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by client name or PID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-search-projects"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="Draft">Draft</SelectItem>
              <SelectItem value="Generated">Generated</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-48 bg-muted/50 animate-pulse rounded-lg" />
            ))}
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="text-center py-12">
            {projects.length === 0 ? (
              <>
                <p className="text-muted-foreground mb-4">No projects yet. Create your first project to get started.</p>
                <Button onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Project
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground">No projects match your search criteria.</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProjects.map((project) => (
              <Card 
                key={project.id}
                className="hover-elevate active-elevate-2 cursor-pointer transition-all relative group" 
                onClick={() => setLocation(`/project/${project.id}`)}
                data-testid={`card-project-${project.clientName.toLowerCase().replace(/\s/g, '-')}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-lg truncate" data-testid="text-client-name">
                        {project.clientName}
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1" data-testid="text-project-type">
                        {project.projectType}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge 
                        variant={project.status === "Generated" ? "default" : "secondary"}
                        data-testid="badge-status"
                      >
                        {project.status}
                      </Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity" data-testid={`button-project-menu-${project.id}`}>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem 
                            onClick={(e) => handleDuplicateProject(e, project.id)}
                            disabled={duplicateProjectMutation.isPending}
                            data-testid={`button-duplicate-${project.id}`}
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={(e) => handleDeleteProject(e, project.id)}
                            className="text-destructive"
                            data-testid={`button-delete-${project.id}`}
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
                  {project.totalQuotes !== undefined && (
                    <div className="flex items-center gap-2 text-sm">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground" data-testid="text-total-quotes">
                        {project.totalQuotes} {project.totalQuotes === 1 ? 'line item' : 'line items'}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    <span data-testid="text-last-updated">
                      {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      <CreateProjectDialog
        open={createDialogOpen}
        onOpenChange={handleCreateDialogOpenChange}
        onSubmit={handleCreateProject}
        initialValues={crmPrefill ?? undefined}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this project? This will permanently remove all rooms and line items. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDelete} 
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
