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
  isSubmitting?: boolean;
  onOpenChange: (open: boolean) => void;
  onBack: () => void;
  onSubmit: (data: LineItemFormData) => void;
};

const unique = (items: Array<string | null | undefined>) =>
  Array.from(new Set(items.filter((item): item is string => Boolean(item?.trim())).map((item) => item.trim()))).sort();

export default function FurnitureLineItemWizard({ open, projectId, isSubmitting, onOpenChange, onBack, onSubmit }: Props) {
  const [step, setStep] = useState(1);
  const [brand, setBrand] = useState("");
  const [workType, setWorkType] = useState("Standard Furniture");
  const [area, setArea] = useState("");
  const [category, setCategory] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [finishType, setFinishType] = useState("");
  const [finishMaterial, setFinishMaterial] = useState("");
  const [quantity, setQuantity] = useState(1);
  const { data: catalog = [], isLoading } = useQuery<CatalogItem[]>({
    queryKey: ["/api/catalog", "DeX - Furniture", projectId],
    queryFn: async () => {
      const params = new URLSearchParams({ category: "DeX - Furniture" });
      if (projectId) params.set("projectId", projectId);
      const response = await fetch(`/api/catalog?${params}`);
      if (!response.ok) throw new Error("Failed to fetch Furniture master");
      return response.json();
    },
    enabled: open,
    staleTime: 0,
  });
  const available = useMemo(() => catalog.filter((item) => item.isActive !== false && (item.sellingPrice || item.rate || 0) > 0), [catalog]);
  const byBrand = available.filter((item) => item.brand === brand);
  const byType = byBrand.filter((item) => item.section?.trim().toLowerCase() === workType.toLowerCase());
  const byArea = byType.filter((item) => item.applicableArea === area);
  const byCategory = byArea.filter((item) => item.productCategory === category);
  const bySubCategory = byCategory.filter((item) => item.subCategory === subCategory);
  const byFinish = bySubCategory.filter((item) => item.finishType === finishType);
  const selected = byFinish.find((item) => item.materialType === finishMaterial);
  const totalSteps = 9;
  const options = {
    brands: unique(available.map((item) => item.brand)),
    types: unique(byBrand.map((item) => item.section)),
    areas: unique(byType.map((item) => item.applicableArea)),
    categories: unique(byArea.map((item) => item.productCategory)),
    subCategories: unique(byCategory.map((item) => item.subCategory)),
    finishTypes: unique(bySubCategory.map((item) => item.finishType)),
    finishMaterials: unique(byFinish.map((item) => item.materialType)),
  };
  const nextValid = [true, Boolean(brand), Boolean(workType), Boolean(area), Boolean(category), Boolean(subCategory), Boolean(finishType), Boolean(finishMaterial && selected), quantity > 0][step - 1];
  const resetAfter = (setter: () => void) => { setter(); setStep(Math.min(totalSteps, step + 1)); };
  const choose = (label: string, value: string, onChange: (value: string) => void, values: string[]) => (
    <div className="space-y-4">
      <div><h3 className="font-semibold text-lg">Step {step}: Select {label}</h3><p className="text-sm text-muted-foreground">Options are loaded from the Furniture Master.</p></div>
      <SearchableSelect
        value={value}
        options={values}
        onValueChange={onChange}
        placeholder={`Select ${label}`}
        emptyMessage={`No ${label.toLowerCase()} options match your search.`}
        searchPlaceholder={`Search ${label.toLowerCase()}...`}
        testId={`select-furniture-${label.toLowerCase().replace(/\s+/g, "-")}`}
      />
    </div>
  );
  const submit = () => {
    if (!selected) return;
    onSubmit({
      unitType: selected.unitType,
      materialType: selected.materialType || undefined,
      description: selected.description,
      lengthFt: 0, heightFt: 0, quantity,
      itemType: "furniture" as ItemType,
      catalogItemId: selected.id,
      rate: selected.sellingPrice || selected.rate,
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-add-furniture">
        <DialogHeader><DialogTitle>Add Standard Furniture</DialogTitle></DialogHeader>
        {isLoading ? <div className="py-16 text-center"><Loader2 className="mx-auto animate-spin" /> <p className="mt-3 text-sm text-muted-foreground">Loading Furniture Master…</p></div> : (
          <div className="space-y-6">
            <div className="flex items-center justify-between">{Array.from({ length: totalSteps }, (_, index) => <span key={index} className={`h-2 flex-1 mx-0.5 rounded ${index + 1 <= step ? "bg-primary" : "bg-muted"}`} />)}</div>
            {step === 1 && choose("Brand", brand, (value) => { setBrand(value); setArea(""); setCategory(""); setSubCategory(""); setFinishType(""); setFinishMaterial(""); }, options.brands)}
            {step === 2 && choose("Type", workType, (value) => { setWorkType(value); setArea(""); setCategory(""); setSubCategory(""); setFinishType(""); setFinishMaterial(""); }, options.types.filter((value) => value.trim().toLowerCase() === "standard furniture"))}
            {step === 3 && choose("Applicable Area", area, (value) => { setArea(value); setCategory(""); setSubCategory(""); setFinishType(""); setFinishMaterial(""); }, options.areas)}
            {step === 4 && choose("Category", category, (value) => { setCategory(value); setSubCategory(""); setFinishType(""); setFinishMaterial(""); }, options.categories)}
            {step === 5 && choose("Sub Category", subCategory, (value) => { setSubCategory(value); setFinishType(""); setFinishMaterial(""); }, options.subCategories)}
            {step === 6 && choose("Finish Type", finishType, (value) => { setFinishType(value); setFinishMaterial(""); }, options.finishTypes)}
            {step === 7 && choose("Finish Material", finishMaterial, setFinishMaterial, options.finishMaterials)}
            {step === 8 && selected && <div className="space-y-4"><h3 className="font-semibold text-lg">Step 8: Quantity</h3><Card><CardContent className="pt-6 grid grid-cols-2 gap-3 text-sm">{selected.imageUrl && <img src={selected.imageUrl} className="row-span-3 h-28 w-28 rounded border object-contain" alt={selected.description} />}<div><span className="text-muted-foreground">Description</span><p className="font-medium">{selected.description}</p></div><div><span className="text-muted-foreground">Dimension</span><p className="font-medium">{selected.dimension || "N/A"}</p></div><div><span className="text-muted-foreground">Unit</span><p className="font-medium">{selected.unitType}</p></div><div><span className="text-muted-foreground">MRP (GST Inclusive)</span><p className="font-medium">₹{Math.round(selected.sellingPrice || selected.rate || 0).toLocaleString("en-IN")}</p></div></CardContent></Card><Label htmlFor="furniture-quantity">Quantity</Label><Input id="furniture-quantity" data-testid="input-furniture-quantity" type="number" min="0.5" step="0.5" value={quantity} onChange={(event) => setQuantity(Number(event.target.value) || 0)} /></div>}
            {step === 9 && selected && <Card><CardContent className="pt-6 space-y-2"><h3 className="font-semibold text-lg">Review & Confirm</h3><p className="font-medium">{selected.description}</p><p className="text-sm text-muted-foreground">{selected.dimension || "No dimension"} · {quantity} {selected.unitType}</p><p className="text-xl font-bold text-primary">₹{Math.round((selected.sellingPrice || selected.rate || 0) * quantity).toLocaleString("en-IN")} <span className="text-sm font-normal">GST Inclusive</span></p></CardContent></Card>}
            <div className="flex justify-between"><Button variant="outline" onClick={() => step === 1 ? onBack() : setStep(step - 1)}><ChevronLeft className="mr-2 h-4 w-4" />Back</Button>{step < totalSteps ? <Button disabled={!nextValid} onClick={() => setStep(step + 1)}>Next<ChevronRight className="ml-2 h-4 w-4" /></Button> : <Button disabled={!selected || isSubmitting} onClick={submit}>Add Furniture</Button>}</div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}