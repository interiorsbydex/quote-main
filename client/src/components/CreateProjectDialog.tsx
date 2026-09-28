import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { LockKeyhole, Plus, Users } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { DexStyle, Client, Project } from "@/lib/types";
import { findLatestPidForClient } from "@/lib/project-folders";

export interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: ProjectFormData) => void;
  projects?: Project[];
  /** Initial values applied when the dialog opens, e.g. prefilled from a CRM deep link. */
  initialValues?: Partial<ProjectFormData>;
}

export type { DexStyle };

export interface ProjectFormData {
  clientId?: string;
  clientName: string;
  pid: string; // Project ID for easy reference/search
  projectType: "Residential" | "Commercial" | "Others";
  category: DexStyle;
  multiStyleEnabled: boolean;
  leadId?: string;
  phone?: string;
  email?: string;
  scope?: string;
  location?: string;
  estimatedValue?: string;
}

interface FormErrors {
  clientName?: string;
  pid?: string;
}

export default function CreateProjectDialog({ open, onOpenChange, onSubmit, initialValues, projects = [] }: CreateProjectDialogProps) {
  const [formData, setFormData] = useState<ProjectFormData>({
    clientId: undefined,
    clientName: "",
    pid: "",
    projectType: "Residential",
    category: "DeX - Xpress",
    multiStyleEnabled: false,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isNewClient, setIsNewClient] = useState(true);
  const crmPidIsLocked = Boolean(initialValues?.pid?.trim());

  // Apply CRM deep-link prefill values each time the dialog opens.
  useEffect(() => {
    if (open && initialValues) {
      setFormData((prev) => ({
        ...prev,
        clientName: initialValues.clientName ?? prev.clientName,
        pid: initialValues.pid ?? prev.pid,
        projectType: initialValues.projectType ?? "Residential",
        leadId: initialValues.leadId,
        phone: initialValues.phone,
        email: initialValues.email,
        scope: initialValues.scope,
        location: initialValues.location,
        estimatedValue: initialValues.estimatedValue,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['/api/clients'],
    enabled: open,
  });

  const createClientMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest('POST', '/api/clients', { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/clients'] });
    },
  });

  const validateField = (field: string, value: string): string | undefined => {
    switch (field) {
      case 'clientName':
        if (!value.trim()) return "Client name is required";
        if (value.trim().length < 2) return "Client name must be at least 2 characters";
        if (value.trim().length > 100) return "Client name must be less than 100 characters";
        return undefined;
      case 'pid':
        if (!value.trim()) return "Project ID (PID) is required";
        if (value.trim().length > 100) return "Project ID must be less than 100 characters";
        return undefined;
      default:
        return undefined;
    }
  };

  const handleFieldChange = (field: keyof ProjectFormData, value: any) => {
    setFormData({ ...formData, [field]: value });
    if (touched[field]) {
      const error = validateField(field, value);
      setErrors({ ...errors, [field]: error });
    }
  };

  const handleBlur = (field: string) => {
    setTouched({ ...touched, [field]: true });
    const value = formData[field as keyof ProjectFormData];
    const error = validateField(field, String(value));
    setErrors({ ...errors, [field]: error });
  };

  const handleClientSelect = (clientId: string) => {
    if (clientId === "new") {
      setIsNewClient(true);
      setFormData({
        ...formData,
        clientId: undefined,
        clientName: "",
        pid: crmPidIsLocked ? formData.pid : "",
      });
    } else {
      const client = clients.find(c => c.id === clientId);
      if (client) {
        setIsNewClient(false);
        setFormData({
          ...formData,
          clientId: client.id,
          clientName: client.name,
          pid: crmPidIsLocked ? formData.pid : findLatestPidForClient(projects, client.id),
        });
        setErrors(prev => ({ ...prev, clientName: undefined, pid: undefined }));
      }
    }
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};
    const clientNameError = validateField('clientName', formData.clientName);
    const pidError = validateField('pid', formData.pid);
    if (clientNameError) newErrors.clientName = clientNameError;
    if (pidError) newErrors.pid = pidError;
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ clientName: true, pid: true });
    if (!validateForm()) return;
    
    let finalClientId = formData.clientId;
    
    // If new client name was entered without selecting existing, create client first
    if (isNewClient && formData.clientName.trim()) {
      try {
        const newClient = await createClientMutation.mutateAsync(formData.clientName.trim());
        finalClientId = newClient.id;
      } catch (error: any) {
        console.error("Failed to create client:", error);
        setErrors({ clientName: error.message || "Failed to save client" });
        return; // Don't proceed with project creation
      }
    }
    
    onSubmit({
      ...formData,
      clientId: finalClientId,
      clientName: formData.clientName.trim(),
      pid: formData.pid.trim(),
    });
    onOpenChange(false);
    setFormData({
      clientId: undefined,
      clientName: "",
      pid: "",
      projectType: "Residential",
      category: "DeX - Xpress",
      multiStyleEnabled: false,
    });
    setErrors({});
    setTouched({});
    setIsNewClient(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="dialog-create-project">
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
          <DialogDescription>
            Enter the project details to get started with your quotation.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            {clients.length > 0 && (
              <div className="space-y-2">
                <Label>Select Existing Client</Label>
                <Select
                  value={isNewClient ? "new" : formData.clientId}
                  onValueChange={handleClientSelect}
                >
                  <SelectTrigger data-testid="select-existing-client">
                    <SelectValue placeholder="Select a client or add new" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">
                      <span className="flex items-center gap-2">
                        <Plus className="h-4 w-4" />
                        Add New Client
                      </span>
                    </SelectItem>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        <span className="flex items-center gap-2">
                          <Users className="h-4 w-4" />
                          {client.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="clientName">
                {isNewClient ? "New Client Name" : "Client Name"}
              </Label>
              <Input
                id="clientName"
                value={formData.clientName}
                onChange={(e) => handleFieldChange('clientName', e.target.value)}
                onBlur={() => handleBlur('clientName')}
                placeholder="Enter client name"
                className={errors.clientName ? "border-destructive" : ""}
                disabled={!isNewClient}
                data-testid="input-client-name"
              />
              {errors.clientName && touched.clientName && (
                <p className="text-sm text-destructive" data-testid="error-client-name">
                  {errors.clientName}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="pid" className="flex items-center gap-1">
                Project ID (PID) <span className="text-destructive">*</span>
                {crmPidIsLocked && <LockKeyhole className="h-3.5 w-3.5 text-muted-foreground" aria-label="Locked from CRM" />}
              </Label>
              <Input
                id="pid"
                value={formData.pid}
                onChange={(e) => handleFieldChange('pid', e.target.value)}
                onBlur={() => handleBlur('pid')}
                placeholder="Enter project ID"
                readOnly={crmPidIsLocked}
                aria-readonly={crmPidIsLocked}
                aria-required="true"
                className={`${crmPidIsLocked ? "bg-muted text-muted-foreground" : ""} ${errors.pid ? "border-destructive" : ""}`}
                data-testid="input-pid"
              />
              {errors.pid && touched.pid && (
                <p className="text-sm text-destructive" data-testid="error-pid">
                  {errors.pid}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {crmPidIsLocked
                  ? "Filled by CRM and locked for this quote"
                  : !isNewClient && formData.pid
                    ? "Filled from this client's most recently updated project"
                    : "Required. Quotes with the same PID are grouped in one folder."}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="projectType">Project Type</Label>
                <Select
                  value={formData.projectType}
                  onValueChange={(value: any) => setFormData({ ...formData, projectType: value })}
                >
                  <SelectTrigger id="projectType" data-testid="select-project-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Residential">Residential</SelectItem>
                    <SelectItem value="Commercial">Commercial</SelectItem>
                    <SelectItem value="Others">Others</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="category">Style Category</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value: any) => setFormData({ ...formData, category: value })}
                >
                  <SelectTrigger id="category" data-testid="select-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DeX - Xpress">Xpress</SelectItem>
                    <SelectItem value="DeX - Xpand">Xpand</SelectItem>
                    <SelectItem value="DeX - Xclusive">Xclusive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {(initialValues?.leadId || initialValues?.phone || initialValues?.email || initialValues?.scope || initialValues?.location || initialValues?.estimatedValue) && (
              <div className="rounded-lg border bg-muted/30 p-4 space-y-2" data-testid="crm-prefill-details">
                <p className="text-sm font-medium">CRM details</p>
                <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm text-muted-foreground md:grid-cols-2">
                  {initialValues.leadId && <p><span className="font-medium text-foreground">Lead ID:</span> {initialValues.leadId}</p>}
                  {initialValues.phone && <p><span className="font-medium text-foreground">Phone:</span> {initialValues.phone}</p>}
                  {initialValues.email && <p><span className="font-medium text-foreground">Email:</span> {initialValues.email}</p>}
                  {initialValues.scope && <p><span className="font-medium text-foreground">Scope:</span> {initialValues.scope}</p>}
                  {initialValues.location && <p><span className="font-medium text-foreground">Location:</span> {initialValues.location}</p>}
                  {initialValues.estimatedValue && <p><span className="font-medium text-foreground">Estimated value:</span> {initialValues.estimatedValue}</p>}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="multiStyle" className="text-base">
                  Multiple Style Preferences
                </Label>
                <p className="text-sm text-muted-foreground">
                  Allow different style categories for each room
                </p>
              </div>
              <Switch
                id="multiStyle"
                checked={formData.multiStyleEnabled}
                onCheckedChange={(checked) => setFormData({ ...formData, multiStyleEnabled: checked })}
                data-testid="switch-multi-style"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel">
              Cancel
            </Button>
            <Button type="submit" disabled={createClientMutation.isPending} data-testid="button-create">
              {createClientMutation.isPending ? "Creating..." : "Create Project"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
