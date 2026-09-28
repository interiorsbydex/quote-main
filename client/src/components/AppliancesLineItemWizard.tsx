import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { CatalogItem, ItemType } from "@/lib/types";
import type { LineItemFormData } from "./AddLineItemWizard";
import SearchableSelect from "./SearchableSelect";

type Props = {
  open: boolean;
  projectId?: string;
  projectVariant?: string;
  isSubmitting?: boolean;
  onOpenChange: (open: boolean) => void;
  onBack: () => void;
  onSubmit: (data: LineItemFormData) => void;
};

const unique = (items: Array<string | null | undefined>) =>
  Array.from(new Set(items.filter((item): item is string => Boolean(item?.trim())).map((item) => item.trim()))).sort();

const variantName = (value?: string) => value?.replace(/^DeX\s*-\s*/i, "").trim().toLowerCase() || "";

function supportsVariant(projectType: string | undefined, projectVariant?: string) {
  if (!projectVariant) return true;
  const target = variantName(projectVariant);
  const variants = (projectType || "").split(/[,;/]/).map(variantName).filter(Boolean);
  return variants.length === 0 || variants.includes(target);
}

export default function AppliancesLineItemWizard({
  open, projectId, projectVariant, isSubmitting, onOpenChange, onBack, onSubmit,
}: Props) {
  const [step, setStep] = useState(1);
  const [brand, setBrand] = useState("");
  const [workType, setWorkType] = useState("");
  const [category, setCategory] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [dimension, setDimension] = useState("");
  const [quantity, setQuantity] = useState(1);

  const { data: catalog = [], isLoading } = useQuery<CatalogItem[]>({
    queryKey: ["/api/catalog", "DeX - Appliances", projectId],
    queryFn: async () => {
      const params = new URLSearchParams({ category: "DeX - Appliances" });
      if (projectId) params.set("projectId", projectId);
      const response = await fetch(`/api/catalog?${params}`);
      if (!response.ok) throw new Error("Failed to fetch Appliances master");
      return response.json();
    },
    enabled: open,
    staleTime: 0,
  });

  const available = useMemo(
    // Appliances Master has no Active-column workflow. Older synced versions can carry
    // a stale false value here, which must not hide otherwise valid products and brands.
    () => catalog.filter((item) => (item.sellingPrice || item.rate || 0) > 0 && supportsVariant(item.projectType, projectVariant)),
    [catalog, projectVariant],
  );
  const byBrand = available.filter((item) => item.brand === brand);
  const byWorkType = byBrand.filter((item) => item.section === workType);
  const byCategory = byWorkType.filter((item) => item.productCategory === category);
  const bySubCategory = byCategory.filter((item) => item.subCategory === subCategory);
  const selected = bySubCategory.find((item) => item.dimension === dimension);
  const options = {
    brands: unique(available.map((item) => item.brand)),
    workTypes: unique(byBrand.map((item) => item.section)),
    categories: unique(byWorkType.map((item) => item.productCategory)),
    subCategories: unique(byCategory.map((item) => item.subCategory)),
    dimensions: unique(bySubCategory.map((item) => item.dimension)),
  };
  const totalSteps = 7;
  const valid = [Boolean(brand), Boolean(workType), Boolean(category), Boolean(subCategory), Boolean(dimension && selected), quantity > 0, Boolean(selected)][step - 1];

  const choose = (
    label: string,
    value: string,
    values: string[],
    onChange: (value: string) => void,
  ) => (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-lg">Step {step}: Select {label}</h3>
        <p className="text-sm text-muted-foreground">Options are loaded from the Appliances Master.</p>
      </div>
      <SearchableSelect
        value={value}
        options={values}
        onValueChange={onChange}
        placeholder={`Select ${label}`}
        emptyMessage={`No ${label.toLowerCase()} options match your search.`}
        searchPlaceholder={`Search ${label.toLowerCase()}...`}
        testId={`select-appliances-${label.toLowerCase().replace(/\s+/g, "-")}`}
      />
    </div>
  );

  const submit = () => {
    if (!selected) return;
    onSubmit({
      unitType: selected.unitType,
      description: selected.description,
      lengthFt: 0,
      heightFt: 0,
      quantity,
      itemType: "accessories" as ItemType,
      catalogItemId: selected.id,
      rate: selected.sellingPrice || selected.rate,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-add-appliances">
        <DialogHeader><DialogTitle>Add Appliances</DialogTitle></DialogHeader>
        {isLoading ? (
          <div className="py-16 text-center"><Loader2 className="mx-auto animate-spin" /><p className="mt-3 text-sm text-muted-foreground">Loading Appliances Master…</p></div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between">{Array.from({ length: totalSteps }, (_, index) => <span key={index} className={`h-2 flex-1 mx-0.5 rounded ${index + 1 <= step ? "bg-primary" : "bg-muted"}`} />)}</div>
            {step === 1 && choose("Brand", brand, options.brands, (value) => { setBrand(value); setWorkType(""); setCategory(""); setSubCategory(""); setDimension(""); })}
            {step === 2 && choose("Work Type", workType, options.workTypes, (value) => { setWorkType(value); setCategory(""); setSubCategory(""); setDimension(""); })}
            {step === 3 && choose("Category", category, options.categories, (value) => { setCategory(value); setSubCategory(""); setDimension(""); })}
            {step === 4 && choose("Sub Category", subCategory, options.subCategories, (value) => { setSubCategory(value); setDimension(""); })}
            {step === 5 && choose("Dimension", dimension, options.dimensions, setDimension)}
            {step === 6 && selected && (
              <div className="space-y-4">
                <h3 className="font-semibold text-lg">Step 6: Quantity</h3>
                <Card><CardContent className="pt-6 grid grid-cols-2 gap-3 text-sm">
                  {selected.imageUrl && <img src={selected.imageUrl} className="row-span-4 h-28 w-28 rounded border object-contain" alt={selected.description} />}
                  <div><span className="text-muted-foreground">Description</span><p className="font-medium">{selected.description}</p></div>
                  <div><span className="text-muted-foreground">Dimension</span><p className="font-medium">{selected.dimension}</p></div>
                  <div><span className="text-muted-foreground">Unit</span><p className="font-medium">{selected.unitType}</p></div>
                  <div><span className="text-muted-foreground">MRP (GST Inclusive)</span><p className="font-medium">₹{Math.round(selected.sellingPrice || selected.rate || 0).toLocaleString("en-IN")}</p></div>
                </CardContent></Card>
                <Label htmlFor="appliances-quantity">Quantity</Label>
                <Input id="appliances-quantity" data-testid="input-appliances-quantity" type="number" min="0.5" step="0.5" value={quantity} onChange={(event) => setQuantity(Number(event.target.value) || 0)} />
              </div>
            )}
            {step === 7 && selected && (
              <Card><CardContent className="pt-6 space-y-2">
                <h3 className="font-semibold text-lg">Review & Confirm</h3>
                {selected.imageUrl && <img src={selected.imageUrl} className="h-28 w-28 rounded border object-contain" alt={selected.description} />}
                <p className="font-medium">{selected.description}</p>
                <p className="text-sm text-muted-foreground">{selected.dimension} · {quantity} {selected.unitType}</p>
                <p className="text-xl font-bold text-primary">₹{Math.round((selected.sellingPrice || selected.rate || 0) * quantity).toLocaleString("en-IN")} <span className="text-sm font-normal">GST Inclusive</span></p>
              </CardContent></Card>
            )}
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => step === 1 ? onBack() : setStep(step - 1)}><ChevronLeft className="mr-2 h-4 w-4" />Back</Button>
              {step < totalSteps ? <Button disabled={!valid} onClick={() => setStep(step + 1)}>Next<ChevronRight className="ml-2 h-4 w-4" /></Button> : <Button disabled={!selected || isSubmitting} onClick={submit}>Add Appliances</Button>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}