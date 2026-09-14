import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { CatalogItem, ItemType } from "@/lib/types";
import type { LineItemFormData } from "./AddLineItemWizard";
import SearchableSelect from "./SearchableSelect";

type Props = { open: boolean; projectId?: string; isSubmitting?: boolean; onOpenChange: (open: boolean) => void; onBack: () => void; onSubmit: (data: LineItemFormData) => void };
const unique = (values: Array<string | null | undefined>) => Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))).sort();
const normalized = (value: string | null | undefined) => String(value || "").toLowerCase().replace("custome", "custom").replace("finsh", "finish").trim();
const matches = (catalogValue: string | null | undefined, selectedValue: string) => normalized(catalogValue) === normalized(selectedValue);
const fieldLabel = { lengthFt: "Length", heightFt: "Height", depthFt: "Depth" } as const;

export default function CustomFurnitureLineItemWizard({ open, projectId, isSubmitting, onOpenChange, onBack, onSubmit }: Props) {
  const [step, setStep] = useState(1);
  const [brand, setBrand] = useState(""), [area, setArea] = useState(""), [category, setCategory] = useState(""), [subCategory, setSubCategory] = useState(""), [finishMaterial, setFinishMaterial] = useState("");
  const [lengthFt, setLengthFt] = useState(0), [heightFt, setHeightFt] = useState(0), [depthFt, setDepthFt] = useState(0), [quantity, setQuantity] = useState(1);
  const { data: catalog = [], isLoading } = useQuery<CatalogItem[]>({ queryKey: ["/api/catalog", "DeX - Furniture", projectId], queryFn: async () => { const params = new URLSearchParams({ category: "DeX - Furniture" }); if (projectId) params.set("projectId", projectId); const response = await fetch(`/api/catalog?${params}`); if (!response.ok) throw new Error("Failed to fetch Furniture Master"); return response.json(); }, enabled: open, staleTime: 0 });
  const available = useMemo(() => catalog.filter((item) => item.isActive !== false && (item.sellingPrice || item.rate || 0) > 0 && normalized(item.section).includes("custom") && normalized(item.finishType).includes("custom")), [catalog]);
  const byBrand = available.filter((item) => matches(item.brand, brand)), byArea = byBrand.filter((item) => matches(item.applicableArea, area)), byCategory = byArea.filter((item) => matches(item.productCategory, category)), bySubCategory = byCategory.filter((item) => matches(item.subCategory, subCategory));
  const selected = bySubCategory.find((item) => matches(item.materialType, finishMaterial));
  const options = { brands: unique(available.map((item) => item.brand)), areas: unique(byBrand.map((item) => item.applicableArea)), categories: unique(byArea.map((item) => item.productCategory)), subCategories: unique(byCategory.map((item) => item.subCategory)), materials: unique(bySubCategory.map((item) => item.materialType)) };
  const measurementFields = selected ? ([
    selected.requiresLength && ["lengthFt", lengthFt, setLengthFt],
    selected.requiresHeight && ["heightFt", heightFt, setHeightFt],
    selected.requiresDepth && ["depthFt", depthFt, setDepthFt],
  ].filter(Boolean) as Array<[keyof typeof fieldLabel, number, (value: number) => void]>) : [];
  const measurementsValid = measurementFields.every(([, value]) => value > 0);
  const totalSteps = 8;
  const nextValid = [Boolean(brand), Boolean(area), Boolean(category), Boolean(subCategory), Boolean(finishMaterial && selected), measurementsValid, quantity > 0, true][step - 1];
  const choose = (label: string, value: string, values: string[], onChange: (value: string) => void) => <div className="space-y-4"><div><h3 className="text-lg font-semibold">Step {step}: Select {label}</h3><p className="text-sm text-muted-foreground">Options are loaded from the Furniture Master.</p></div><SearchableSelect value={value} options={values} onValueChange={onChange} placeholder={`Select ${label}`} emptyMessage={`No ${label.toLowerCase()} options match your search.`} searchPlaceholder={`Search ${label.toLowerCase()}...`} testId={`select-custom-furniture-${label.toLowerCase().replace(/\s+/g, "-")}`} /></div>;
  const description = selected ? [selected.brand, "Custom Furniture", selected.applicableArea, selected.productCategory, selected.subCategory, "Custom Finish", selected.materialType].filter(Boolean).join(" · ") : "";
  const submit = () => selected && onSubmit({ unitType: selected.unitType, materialType: selected.materialType || undefined, description, lengthFt, heightFt, depthFt, quantity, itemType: "furniture" as ItemType, catalogItemId: selected.id, rate: selected.sellingPrice || selected.rate });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-add-custom-furniture"><DialogHeader><DialogTitle>Add Custom Furniture</DialogTitle></DialogHeader>{isLoading ? <div className="py-16 text-center"><Loader2 className="mx-auto animate-spin" /><p className="mt-3 text-sm text-muted-foreground">Loading Furniture Master…</p></div> : <div className="space-y-6"><div className="flex">{Array.from({ length: totalSteps }, (_, index) => <span key={index} className={`mx-0.5 h-2 flex-1 rounded ${index + 1 <= step ? "bg-primary" : "bg-muted"}`} />)}</div>
    {step === 1 && choose("Brand", brand, options.brands, (value) => { setBrand(value); setArea(""); setCategory(""); setSubCategory(""); setFinishMaterial(""); })}
    {step === 2 && choose("Applicable Area", area, options.areas, (value) => { setArea(value); setCategory(""); setSubCategory(""); setFinishMaterial(""); })}
    {step === 3 && choose("Category", category, options.categories, (value) => { setCategory(value); setSubCategory(""); setFinishMaterial(""); })}
    {step === 4 && choose("Sub Category", subCategory, options.subCategories, (value) => { setSubCategory(value); setFinishMaterial(""); })}
    {step === 5 && choose("Finish Material", finishMaterial, options.materials, setFinishMaterial)}
    {step === 6 && selected && <div className="space-y-4"><h3 className="text-lg font-semibold">Step 6: Dimensions</h3>{measurementFields.length ? <div className="grid gap-4 sm:grid-cols-3">{measurementFields.map(([key, value, setter]) => <div className="space-y-2" key={key}><Label htmlFor={`custom-furniture-${key}`}>{fieldLabel[key]} (ft)</Label><Input id={`custom-furniture-${key}`} data-testid={`input-custom-furniture-${key}`} type="number" min="0.25" step="0.25" value={value || ""} onChange={(event) => setter(Number(event.target.value) || 0)} /><p className="text-xs text-muted-foreground">{Math.round(value * 304.8)} mm</p></div>)}</div> : <p className="rounded border border-dashed p-4 text-sm text-muted-foreground">No dimensions are required for this item.</p>}</div>}
    {step === 7 && selected && <div className="space-y-4"><h3 className="text-lg font-semibold">Step 7: Quantity</h3><Card><CardContent className="grid gap-3 pt-6 text-sm sm:grid-cols-2">{selected.imageUrl && <img src={selected.imageUrl} alt={selected.description} className="row-span-3 h-28 w-28 rounded border object-contain" />}<div><span className="text-muted-foreground">Description</span><p className="font-medium">{description}</p></div><div><span className="text-muted-foreground">Unit</span><p className="font-medium">{selected.unitType}</p></div><div><span className="text-muted-foreground">MRP (GST Inclusive)</span><p className="font-medium">₹{(selected.sellingPrice || selected.rate || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div></CardContent></Card><Label htmlFor="custom-furniture-quantity">Quantity</Label><Input id="custom-furniture-quantity" data-testid="input-custom-furniture-quantity" type="number" min="0.5" step="0.5" value={quantity} onChange={(event) => setQuantity(Number(event.target.value) || 0)} /></div>}
    {step === 8 && selected && <Card><CardContent className="space-y-2 pt-6"><h3 className="text-lg font-semibold">Review & Confirm</h3><p className="font-medium">{description}</p><p className="text-sm text-muted-foreground">{measurementFields.map(([key, value]) => `${fieldLabel[key]} ${value} ft`).join(" · ") || "No dimensions"} · {quantity} {selected.unitType}</p><p className="text-xl font-bold text-primary">₹{Math.round((selected.sellingPrice || selected.rate || 0) * quantity).toLocaleString("en-IN")} <span className="text-sm font-normal">GST Inclusive</span></p></CardContent></Card>}
    <div className="flex justify-between"><Button variant="outline" onClick={() => step === 1 ? onBack() : setStep(step - 1)}><ChevronLeft className="mr-2 h-4 w-4" />Back</Button>{step < totalSteps ? <Button disabled={!nextValid} onClick={() => setStep(step + 1)}>Next<ChevronRight className="ml-2 h-4 w-4" /></Button> : <Button disabled={!selected || !measurementsValid || isSubmitting} onClick={submit}>Add Furniture</Button>}</div>
  </div>}</DialogContent></Dialog>;
}