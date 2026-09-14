import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Building2, Upload, Save, Loader2, Image, Ruler } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";

const brandSettingsSchema = z.object({
  appName: z.string().min(1, "App name is required"),
  companyName: z.string().min(1, "Company name is required"),
  logoUrl: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  website: z.string().optional(),
  gstNumber: z.string().optional(),
  panNumber: z.string().optional(),
  bankName: z.string().optional(),
  bankAccountNumber: z.string().optional(),
  bankIfscCode: z.string().optional(),
  termsAndConditions: z.string().optional(),
  dimensionDisplayUnit: z.enum(["feet", "mm"]).default("feet"),
});

type BrandSettingsForm = z.infer<typeof brandSettingsSchema>;

interface CompanySettings {
  id?: string;
  appName: string;
  companyName: string;
  logoUrl?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  website?: string;
  gstNumber?: string;
  panNumber?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankIfscCode?: string;
  termsAndConditions?: string;
  dimensionDisplayUnit?: "feet" | "mm";
}

export default function BrandSettings() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const { data: settings, isLoading } = useQuery<CompanySettings>({
    queryKey: ['/api/admin/settings'],
  });

  const form = useForm<BrandSettingsForm>({
    resolver: zodResolver(brandSettingsSchema),
    defaultValues: {
      appName: "Quote Builder",
      companyName: "",
      logoUrl: "",
      address: "",
      city: "",
      state: "",
      pincode: "",
      phone: "",
      email: "",
      website: "",
      gstNumber: "",
      panNumber: "",
      bankName: "",
      bankAccountNumber: "",
      bankIfscCode: "",
      termsAndConditions: "",
      dimensionDisplayUnit: "feet" as const,
    },
    values: settings ? {
      appName: settings.appName || "Quote Builder",
      companyName: settings.companyName || "",
      logoUrl: settings.logoUrl || "",
      address: settings.address || "",
      city: settings.city || "",
      state: settings.state || "",
      pincode: settings.pincode || "",
      phone: settings.phone || "",
      email: settings.email || "",
      website: settings.website || "",
      gstNumber: settings.gstNumber || "",
      panNumber: settings.panNumber || "",
      bankName: settings.bankName || "",
      bankAccountNumber: settings.bankAccountNumber || "",
      bankIfscCode: settings.bankIfscCode || "",
      termsAndConditions: settings.termsAndConditions || "",
      dimensionDisplayUnit: settings.dimensionDisplayUnit || "feet",
    } : undefined,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: BrandSettingsForm) => {
      const res = await apiRequest('PATCH', '/api/admin/settings', data);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Settings saved",
        description: "Brand settings have been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/settings'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save settings",
        variant: "destructive",
      });
    },
  });

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file",
        description: "Please select an image file",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please select an image under 5MB",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('logo', file);

      const res = await fetch('/api/admin/upload-logo', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        throw new Error('Failed to upload logo');
      }

      const { logoUrl } = await res.json();
      form.setValue('logoUrl', logoUrl);
      setLogoPreview(logoUrl);
      toast({
        title: "Logo uploaded",
        description: "Logo has been uploaded successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Upload failed",
        description: error.message || "Failed to upload logo",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = (data: BrandSettingsForm) => {
    updateSettingsMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentLogo = logoPreview || form.watch('logoUrl') || settings?.logoUrl;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Building2 className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-semibold">Brand Settings</h1>
          </div>
          <Link href="/admin">
            <Button variant="ghost" size="sm" data-testid="link-admin-dashboard">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Admin Dashboard
            </Button>
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-4xl">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Application Branding</CardTitle>
                <CardDescription>
                  Customize the application name shown in headers and login page
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="appName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Application Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="Quote Builder" {...field} data-testid="input-app-name" />
                      </FormControl>
                      <FormDescription>
                        This name appears in the header and login page
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Company Logo</CardTitle>
                <CardDescription>
                  Upload your company logo to display on invoices and quotations
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-6">
                  <div className="w-32 h-32 border-2 border-dashed rounded-lg flex items-center justify-center bg-muted/30">
                    {currentLogo ? (
                      <img 
                        src={currentLogo} 
                        alt="Company logo" 
                        className="max-w-full max-h-full object-contain rounded"
                        data-testid="img-logo-preview"
                      />
                    ) : (
                      <Image className="h-12 w-12 text-muted-foreground" />
                    )}
                  </div>
                  <div className="space-y-2">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleLogoUpload}
                      accept="image/*"
                      className="hidden"
                      data-testid="input-logo-file"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      data-testid="button-upload-logo"
                    >
                      {uploading ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4 mr-2" />
                      )}
                      Upload Logo
                    </Button>
                    <p className="text-sm text-muted-foreground">
                      Recommended: PNG or SVG, max 5MB
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Company Information</CardTitle>
                <CardDescription>
                  Basic company details shown on quotations and invoices
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="companyName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="Your Company Name" {...field} data-testid="input-company-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="contact@company.com" {...field} data-testid="input-email" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone</FormLabel>
                        <FormControl>
                          <Input placeholder="+91 98765 43210" {...field} data-testid="input-phone" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="website"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Website</FormLabel>
                      <FormControl>
                        <Input placeholder="https://www.company.com" {...field} data-testid="input-website" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Address</CardTitle>
                <CardDescription>
                  Company address for quotations
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Street Address</FormLabel>
                      <FormControl>
                        <Input placeholder="123 Business Park, Floor 4" {...field} data-testid="input-address" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>City</FormLabel>
                        <FormControl>
                          <Input placeholder="Mumbai" {...field} data-testid="input-city" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="state"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State</FormLabel>
                        <FormControl>
                          <Input placeholder="Maharashtra" {...field} data-testid="input-state" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="pincode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pincode</FormLabel>
                        <FormControl>
                          <Input placeholder="400001" {...field} data-testid="input-pincode" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tax Information</CardTitle>
                <CardDescription>
                  GST and PAN details for invoices
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="gstNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>GST Number</FormLabel>
                        <FormControl>
                          <Input placeholder="27AABCU9603R1ZM" {...field} data-testid="input-gst" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="panNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>PAN Number</FormLabel>
                        <FormControl>
                          <Input placeholder="AABCU9603R" {...field} data-testid="input-pan" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Bank Details</CardTitle>
                <CardDescription>
                  Banking information for payment (shown on invoices)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="bankName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bank Name</FormLabel>
                      <FormControl>
                        <Input placeholder="HDFC Bank" {...field} data-testid="input-bank-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="bankAccountNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Account Number</FormLabel>
                        <FormControl>
                          <Input placeholder="1234567890" {...field} data-testid="input-account-number" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="bankIfscCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>IFSC Code</FormLabel>
                        <FormControl>
                          <Input placeholder="HDFC0001234" {...field} data-testid="input-ifsc" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Terms & Conditions</CardTitle>
                <CardDescription>
                  Default terms shown at the bottom of quotations
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="termsAndConditions"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Textarea 
                          placeholder="Enter your default terms and conditions..."
                          className="min-h-[150px]"
                          {...field}
                          data-testid="input-terms"
                        />
                      </FormControl>
                      <FormDescription>
                        These terms will appear on all generated quotations
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Ruler className="h-5 w-5" />
                  Dimension Display
                </CardTitle>
                <CardDescription>
                  Choose how dimensions appear on customer-facing quotations and shared quotes
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="dimensionDisplayUnit"
                  render={({ field }) => (
                    <FormItem className="space-y-3">
                      <FormLabel>Display dimensions in</FormLabel>
                      <FormControl>
                        <RadioGroup
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                          value={field.value}
                          className="flex flex-col space-y-1"
                        >
                          <FormItem className="flex items-center space-x-3 space-y-0">
                            <FormControl>
                              <RadioGroupItem value="feet" data-testid="radio-dimension-feet" />
                            </FormControl>
                            <FormLabel className="font-normal">
                              Feet (e.g., 8 x 4 ft)
                            </FormLabel>
                          </FormItem>
                          <FormItem className="flex items-center space-x-3 space-y-0">
                            <FormControl>
                              <RadioGroupItem value="mm" data-testid="radio-dimension-mm" />
                            </FormControl>
                            <FormLabel className="font-normal">
                              Millimeters (e.g., 2438 x 1219 mm)
                            </FormLabel>
                          </FormItem>
                        </RadioGroup>
                      </FormControl>
                      <FormDescription>
                        This setting affects the PDF export and shared quote links shown to clients
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button 
                type="submit" 
                disabled={updateSettingsMutation.isPending}
                data-testid="button-save-settings"
              >
                {updateSettingsMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Settings
              </Button>
            </div>
          </form>
        </Form>
      </main>
    </div>
  );
}
