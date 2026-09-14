import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { DEX_CATEGORIES, type CatalogItem, type ItemType } from "@/lib/types";

// Parse finish from material_type string dynamically.
// Strategy:
//   1. For "Finish" types — split by comma and find the segment containing "Finish".
//      This automatically supports any new finish type added to the catalog (e.g. "Veneer Finish").
//   2. For CNC types — use explicit patterns, because CNC appears inside longer
//      descriptive strings like "CNC - Designer CNC Grooves with duco" which have
//      no comma separators and must be matched by keyword.
// Examples:
//   "Carcass - BWP / Shutter - HDF , Glossy Finish , Soft Close , Basic Handle" → "Glossy Finish"
//   "MR+ Finish" → "MR+ Finish"
//   "Panel - HDHMR, Designer Lam  Finish " → "Designer Lam Finish"
//   "Veneer Finish" (new type) → "Veneer Finish"  (works automatically — no code change needed)
//   "CNC - Designer CNC Grooves with duco" → "Designer CNC"
function extractFinish(materialType: string | null | undefined): string | null {
  if (!materialType) return null;

  // Step 1: comma-split, find any segment that contains the word "Finish"
  const parts = materialType.split(/\s*,\s*/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (/\bFinish\b/i.test(trimmed)) {
      return trimmed.replace(/\s+/g, ' ');
    }
  }

  // Step 2: CNC types — pattern match (they appear embedded in longer strings)
  if (/Designer\s+CNC/i.test(materialType)) return 'Designer CNC';
  if (/Normal\s+CNC/i.test(materialType)) return 'Normal CNC';

  // Step 3: Non-"Finish" finish types (e.g. "Designer Fluted")
  if (/Designer\s+Fluted/i.test(materialType)) return 'Designer Fluted';

  return null;
}

// Parse handle type from material_type string
// Examples: "..., Basic Handle" → "Basic Handle"
// "..., Handless - Finger Groove" → "Finger Groove"
// "..., Handless - Gola / G profile" → "Gola / G Profile"
// "..., Essential Handle" → "Essential Handle"
function extractHandle(materialType: string | null | undefined): string | null {
  if (!materialType) return null;
  const handlePatterns = [
    { pattern: /Essential\s+Handle/i, value: "Essential Handle" },
    { pattern: /Essential\s+Handels?/i, value: "Essential Handle" },
    { pattern: /Basic Handle/i, value: "Basic Handle" },
    { pattern: /Handless\s*-\s*Finger\s*Groove/i, value: "Finger Groove" },
    { pattern: /Handless\s*-\s*Gola\s*\/?\s*G\s*profile/i, value: "Gola / G Profile" },
    { pattern: /G\s*Profile/i, value: "Gola / G Profile" },
  ];
  for (const { pattern, value } of handlePatterns) {
    if (pattern.test(materialType)) return value;
  }
  return null;
}

export interface AddLineItemWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: LineItemFormData) => void;
  roomType?: "Wet / Exposed" | "Dry / Inexposed";
  category?: string; // Accepts DexCategory or legacy categories for backward compatibility
  isSubmitting?: boolean; // Shows loading state on submit button
  // Prices this quotation against the version the project was created with, so an open
  // quotation keeps its prices even after the catalog is republished.
  projectId?: string;
}

export interface LineItemFormData {
  unitType: string;
  materialType?: string; // Full material string from catalog
  finish?: string; // Parsed finish selection
  handle?: string; // Parsed handle selection
  handleFinish?: string; // For handles category: finish filter extracted from description
  workType?: string; // For services: section (Civil Services, etc.)
  brand?: string; // For accessories: brand filter
  size?: string; // For handles: size filter
  image?: string; // For handles: image/product selection
  description: string;
  lengthFt: number;
  heightFt: number;
  quantity: number;
  itemType: ItemType; // For GST calculation - woodworks/services/accessories
  catalogItemId?: string; // ID of the selected catalog item for server-side rate lookup
  rate?: number; // Rate from catalog item (fallback if server lookup fails)
}

// Item category types for multi-category support per room
const ITEM_CATEGORY_OPTIONS = [
  { value: "woodworks", label: "Woodwork", description: "Cabinets, storage units, wardrobes" },
  { value: "accessories", label: "Accessories", description: "Hardware, pullouts, organizers" },
  { value: "services", label: "Services", description: "Installation, labor, services" },
  { value: "lights", label: "Lights", description: "Lighting fixtures" },
  { value: "stone", label: "Stone/Quartz", description: "Countertops, surfaces" },
  { value: "handles", label: "Handles", description: "Cabinet handles, knobs" },
] as const;

type ItemCategoryType = typeof ITEM_CATEGORY_OPTIONS[number]["value"];

// Map item category type to catalog category
function getCatalogCategory(itemCategoryType: ItemCategoryType, woodworksStyle?: string): string | undefined {
  switch (itemCategoryType) {
    case "woodworks":
      return woodworksStyle; // Use room's style (Xpress/Xpand)
    case "accessories":
      return "DeX - Accessories";
    case "services":
      return "DeX - Services";
    case "lights":
      return "DeX - Lights";
    case "stone":
      return "DeX - Stone Master";
    case "handles":
      return "DeX - Handles";
    default:
      return undefined;
  }
}

export default function AddLineItemWizard({ 
  open, 
  onOpenChange, 
  onSubmit,
  roomType,
  category,
  isSubmitting = false,
  projectId
}: AddLineItemWizardProps) {
  const [step, setStep] = useState(1);
  const [selectedItemCategory, setSelectedItemCategory] = useState<ItemCategoryType>("woodworks");
  const [formData, setFormData] = useState<LineItemFormData>({
    unitType: "",
    materialType: "",
    finish: "",
    handle: "",
    handleFinish: "",
    workType: "", // For services hierarchy
    brand: "", // For accessories
    size: "", // For handles
    image: "", // For handles: image/product selection
    description: "",
    lengthFt: 0,
    heightFt: 0,
    quantity: 1,
    itemType: "woodworks", // Default, will be updated from catalog item
  });

  // Determine the effective catalog category based on selected item type
  const effectiveCategory = getCatalogCategory(selectedItemCategory, category);
  
  // Check if category is a valid DeX category
  const isValidDexCategory = effectiveCategory && (DEX_CATEGORIES as readonly string[]).includes(effectiveCategory);
  
  // Room type filtering only applies to Xpress/Xpand (woodworks) categories
  const isWoodworksCategory = selectedItemCategory === "woodworks" && 
    (effectiveCategory === "DeX - Xpress" || effectiveCategory === "DeX - Xpand");

  // Build query params for server-side filtering
  const catalogParams = new URLSearchParams();
  if (isValidDexCategory && effectiveCategory) {
    catalogParams.set('category', effectiveCategory);
  }
  if (isWoodworksCategory && roomType) {
    catalogParams.set('roomType', roomType);
  }
  // The server decides which prices to return from this; it is never trusted to
  // select a version directly.
  if (projectId) {
    catalogParams.set('projectId', projectId);
  }
  const catalogQueryString = catalogParams.toString();

  // Fetch catalog with server-side filtering for better performance
  const { data: catalog = [], isLoading: catalogLoading } = useQuery<CatalogItem[]>({
    queryKey: ['/api/catalog', effectiveCategory, roomType, selectedItemCategory, projectId],
    queryFn: async () => {
      const url = catalogQueryString 
        ? `/api/catalog?${catalogQueryString}` 
        : '/api/catalog';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch catalog');
      return res.json();
    },
    enabled: open, // Only fetch when dialog is open
    staleTime: 0, // Always fetch fresh catalog after any sync
  });

  // Client-side filtering for template/placeholder items and rate validation
  const filteredCatalog = catalog.filter(item => {
    // Filter out template/placeholder items (contain ** markers or have zero rate)
    if (item.description?.includes('**')) return false;
    if (item.description?.toLowerCase().includes('description format')) return false;
    const itemRate = item.sellingPrice || item.rate || 0;
    if (itemRate <= 0) return false;
    return true;
  });

  // Check category types for conditional flows
  const isServicesCategory = selectedItemCategory === "services";
  const isAccessoriesCategory = selectedItemCategory === "accessories";
  const isHandlesCategory = selectedItemCategory === "handles";
  
  // Start with filtered catalog for filtering chain
  const itemsForWorkType = filteredCatalog;

  const normalizeSpaces = (s: string) => s.replace(/\s+/g, ' ').trim();
  const unitTypeMap = new Map<string, string>();
  itemsForWorkType.forEach(item => {
    if (!item.unitType || item.unitType.trim() === '') return;
    item.unitType.split(',').forEach(t => {
      const trimmed = normalizeSpaces(t);
      if (trimmed) {
        const key = trimmed.toLowerCase();
        if (!unitTypeMap.has(key)) {
          unitTypeMap.set(key, trimmed);
        }
      }
    });
  });
  const unitTypes = Array.from(unitTypeMap.values()).sort();

  const itemsForUnitType = itemsForWorkType.filter(item => {
    if (!item.unitType) return false;
    const itemUnitTypes = item.unitType.split(',').map(t => normalizeSpaces(t).toLowerCase());
    return itemUnitTypes.includes(normalizeSpaces(formData.unitType).toLowerCase());
  });

  // For Accessories: Get unique brands from items matching unit type
  const brands = isAccessoriesCategory 
    ? Array.from(new Set(
        itemsForUnitType
          .map(item => item.brand)
          .filter((b): b is string => !!b && b.trim() !== '')
      )).sort()
    : [];

  // For Accessories: Get items matching selected brand
  const itemsForBrand = isAccessoriesCategory && formData.brand
    ? itemsForUnitType.filter(item => 
        item.brand?.toLowerCase() === formData.brand?.toLowerCase()
      )
    : itemsForUnitType;

  // For Handles: Get unique sizes from material_type field
  const sizes = isHandlesCategory 
    ? Array.from(new Set(
        itemsForUnitType
          .map(item => item.materialType)
          .filter((s): s is string => !!s && s.trim() !== '')
      )).sort()
    : [];

  // For Handles: Get items matching selected size
  const itemsForSize = isHandlesCategory && formData.size
    ? itemsForUnitType.filter(item => 
        item.materialType?.toLowerCase() === formData.size?.toLowerCase()
      )
    : itemsForUnitType;

  // For Handles: Extract unique finish groups from descriptions after size selection
  // Finish info is embedded in descriptions like "(Available Finishes - SS Brush/Black/Matt Rose Gold)"
  const extractHandleFinish = (desc: string | null | undefined): string | null => {
    if (!desc) return null;
    const match = desc.match(/\(?\s*Available\s+Finishes\s*-\s*([^)]+)\)?/i);
    return match ? match[1].trim() : null;
  };
  const handleFinishes = isHandlesCategory
    ? Array.from(new Set(
        itemsForSize
          .map(item => extractHandleFinish(item.description))
          .filter((f): f is string => !!f && f.trim() !== '')
      )).sort()
    : [];

  // For Handles: Whether finish step should show (more than one option)
  const hasHandleFinishes = handleFinishes.length > 1;

  // For Handles: Get items matching selected handle finish
  const itemsForHandleFinish = isHandlesCategory && formData.handleFinish
    ? itemsForSize.filter(item => {
        const itemFinish = extractHandleFinish(item.description);
        return itemFinish?.toLowerCase() === formData.handleFinish?.toLowerCase();
      })
    : itemsForSize;

  // For Handles: Get unique images from items matching finish (or size if no finish step)
  const images = isHandlesCategory 
    ? Array.from(new Set(
        itemsForHandleFinish
          .map(item => item.imageUrl)
          .filter((img): img is string => !!img && img.trim() !== '')
      )).sort()
    : [];

  // For Handles: Get items matching selected image (only filter if images exist AND one is selected)
  const itemsForImage = isHandlesCategory && images.length > 0 && formData.image
    ? itemsForHandleFinish.filter(item => 
        item.imageUrl?.toLowerCase() === formData.image?.toLowerCase()
      )
    : itemsForHandleFinish;

  // For Woodwork: Get unique finishes from material_type
  const finishes = isWoodworksCategory 
    ? Array.from(new Set(
        itemsForUnitType
          .map(item => extractFinish(item.materialType))
          .filter((f): f is string => !!f)
      )).sort()
    : [];

  // For Woodwork: Get items matching selected finish
  const itemsForFinish = isWoodworksCategory && formData.finish
    ? itemsForUnitType.filter(item => {
        const itemFinish = extractFinish(item.materialType);
        return itemFinish?.toLowerCase() === formData.finish?.toLowerCase();
      })
    : itemsForUnitType;

  // For Woodwork: Get unique handles from items matching finish
  const handles = isWoodworksCategory 
    ? Array.from(new Set(
        itemsForFinish
          .map(item => extractHandle(item.materialType))
          .filter((h): h is string => !!h)
      )).sort()
    : [];

  // For Woodwork: Get items matching selected handle
  const itemsForHandle = isWoodworksCategory && formData.handle
    ? itemsForFinish.filter(item => {
        const itemHandle = extractHandle(item.materialType);
        return itemHandle?.toLowerCase() === formData.handle?.toLowerCase();
      })
    : itemsForFinish;

  // Get descriptions filtered by the complete chain
  // For Accessories: use brand-filtered items
  // For Handles: use image-filtered items (if images exist) or size-filtered items
  // For Woodwork: use handle-filtered items
  // For others: use unit type filtered items
  const itemsForDescriptions = isAccessoriesCategory 
    ? itemsForBrand 
    : isHandlesCategory 
      ? itemsForImage 
      : itemsForHandle;
  const descriptions = Array.from(new Set(
    itemsForDescriptions
      .map(item => item.description)
      .filter((desc): desc is string => !!desc && desc.trim() !== '')
  ));

  // Get selected catalog item from the properly filtered list to ensure correct pricing
  const selectedItem = itemsForDescriptions.find(item => item.description === formData.description);

  // Woodwork: Handle step is optional (CNC, Panels etc. don't have handles)
  const hasHandles = handles.length > 0;
  
  // Handles: Image step is optional (only shows if images are available)
  const hasImages = images.length > 0;
  
  // Compute dynamic step numbers for Handles category
  const hStep = (() => {
    let s = 3; // After Size (step 3)
    const finish = hasHandleFinishes ? ++s : -1;
    const image = hasImages ? ++s : -1;
    const desc = ++s;
    const qty = ++s;
    const review = ++s;
    return { finish, image, desc, qty, review };
  })();

  // Dynamic step count based on category:
  // - Woodwork with handles: 7 steps (Item → Unit → Finish → Handle → Description → Dimensions → Review)
  // - Woodwork without handles: 6 steps (Item → Unit → Finish → Description → Dimensions → Review)
  // - Accessories: 6 steps (Item → Unit → Brand → Description → Quantity → Review)
  // - Handles with finish+images: 8 steps (Item → Unit → Size → Finish → Image → Description → Qty → Review)
  // - Handles with finish only: 7 steps (Item → Unit → Size → Finish → Description → Qty → Review)
  // - Handles with images only: 7 steps (Item → Unit → Size → Image → Description → Qty → Review)
  // - Handles basic: 6 steps (Item → Unit → Size → Description → Qty → Review)
  // - Services/Lights/Stone: 5 steps (Item → Unit → Description → Quantity → Review)
  const handlesExtraSteps = (hasHandleFinishes ? 1 : 0) + (hasImages ? 1 : 0);
  const totalSteps = isWoodworksCategory 
    ? (hasHandles ? 7 : 6) 
    : isHandlesCategory
      ? (6 + handlesExtraSteps)
      : isAccessoriesCategory 
        ? 6 
        : 5;

  const handleNext = () => {
    if (step < totalSteps) {
      // For woodwork without handles, skip from Finish (step 3) to Description (step 5 becomes step 4)
      if (isWoodworksCategory && step === 3 && !hasHandles) {
        // When no handles, we skip step 4 but since we're reducing totalSteps, step 4 becomes Description
        // So just increment normally
        setStep(step + 1);
      } else {
        setStep(step + 1);
      }
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleCategoryChange = (value: ItemCategoryType) => {
    setSelectedItemCategory(value);
    // Map category to itemType for server-side calculations
    const mapCategoryToItemType = (cat: ItemCategoryType): ItemType => {
      if (cat === "woodworks") return "woodworks";
      if (cat === "services") return "services";
      return "accessories"; // accessories, lights, stone all use per-unit pricing
    };
    // Reset subsequent selections when category changes
    setFormData({
      ...formData,
      unitType: "",
      materialType: "",
      finish: "",
      handle: "",
      handleFinish: "",
      workType: "",
      brand: "",
      size: "",
      image: "",
      description: "",
      itemType: mapCategoryToItemType(value),
    });
  };

  const handleSubmit = () => {
    // Build the materialType from the selected catalog item for storage
    const materialType = selectedItem?.materialType || 
      (formData.finish && formData.handle ? `${formData.finish}, ${formData.handle}` : undefined);
    
    // Map category to correct itemType for server-side calculations
    // Woodwork items use area-based pricing (rate × sqft × quantity)
    // All others use per-unit pricing (rate × quantity)
    const getItemType = (): ItemType => {
      if (selectedItemCategory === "woodworks") return "woodworks";
      if (selectedItemCategory === "services") return "services";
      // accessories, lights, stone all use per-unit pricing
      return "accessories";
    };
    
    // Get rate from the correctly filtered catalog item
    const itemRate = selectedItem?.sellingPrice || selectedItem?.rate || 0;
    
    const submitData: LineItemFormData = {
      ...formData,
      materialType,
      itemType: getItemType(),
      catalogItemId: selectedItem?.id, // Pass catalog item ID for server-side rate lookup
      rate: itemRate, // Pass rate as fallback
    };
    // Call onSubmit - the parent will handle closing the dialog after mutation completes
    // Form reset happens automatically via useEffect when dialog closes (open becomes false)
    onSubmit(submitData);
  };

  const sqft = formData.lengthFt * formData.heightFt;
  const lengthMm = formData.lengthFt * 300;
  const heightMm = formData.heightFt * 300;
  // Use sellingPrice if available, otherwise fall back to rate (base price)
  const rate = selectedItem?.sellingPrice || selectedItem?.rate || 0;
  // Amount calculation differs by item type:
  // - Woodwork: rate × sqft × quantity (area-based pricing)
  // - Others: rate × quantity (per-unit pricing)
  const amount = isWoodworksCategory 
    ? rate * sqft * formData.quantity 
    : rate * formData.quantity;

  const isStepValid = () => {
    if (catalogLoading && step > 1) return false;
    
    if (isWoodworksCategory) {
      if (hasHandles) {
        // Woodwork flow with handles: 1=Item, 2=Unit, 3=Finish, 4=Handle, 5=Description, 6=Dimensions, 7=Review
        switch (step) {
          case 1: return true;
          case 2: return formData.unitType !== "" && catalog.length > 0;
          case 3: return formData.finish !== "" && finishes.length > 0;
          case 4: return formData.handle !== "" && handles.length > 0;
          case 5: return formData.description !== "" && selectedItem !== undefined;
          case 6: return formData.lengthFt > 0 && formData.heightFt > 0 && formData.quantity > 0;
          case 7: return true;
          default: return false;
        }
      } else {
        // Woodwork flow without handles: 1=Item, 2=Unit, 3=Finish, 4=Description, 5=Dimensions, 6=Review
        switch (step) {
          case 1: return true;
          case 2: return formData.unitType !== "" && catalog.length > 0;
          case 3: return formData.finish !== "" && finishes.length > 0;
          case 4: return formData.description !== "" && selectedItem !== undefined;
          case 5: return formData.lengthFt > 0 && formData.heightFt > 0 && formData.quantity > 0;
          case 6: return true;
          default: return false;
        }
      }
    } else if (isAccessoriesCategory) {
      // Accessories flow: 1=Item, 2=Unit, 3=Brand, 4=Description, 5=Quantity, 6=Review
      switch (step) {
        case 1: return true;
        case 2: return formData.unitType !== "" && catalog.length > 0;
        case 3: return formData.brand !== "" && brands.length > 0;
        case 4: return formData.description !== "" && selectedItem !== undefined;
        case 5: return formData.quantity > 0;
        case 6: return true;
        default: return false;
      }
    } else if (isHandlesCategory) {
      switch (step) {
        case 1: return true;
        case 2: return formData.unitType !== "" && catalog.length > 0;
        case 3: return formData.size !== "" && sizes.length > 0;
        default:
          if (step === hStep.finish) return formData.handleFinish !== "" && handleFinishes.length > 0;
          if (step === hStep.image) return formData.image !== "" && images.length > 0;
          if (step === hStep.desc) return formData.description !== "" && selectedItem !== undefined;
          if (step === hStep.qty) return formData.quantity > 0;
          if (step === hStep.review) return true;
          return false;
      }
    } else {
      // Services/Lights/Stone flow: 1=Item, 2=Unit, 3=Description, 4=Quantity, 5=Review
      switch (step) {
        case 1: return true;
        case 2: return formData.unitType !== "" && catalog.length > 0;
        case 3: return formData.description !== "" && selectedItem !== undefined;
        case 4: return formData.quantity > 0;
        case 5: return true;
        default: return false;
      }
    }
  };

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setStep(1);
      setSelectedItemCategory("woodworks");
      setFormData({
        unitType: "",
        materialType: "",
        finish: "",
        handle: "",
        handleFinish: "",
        workType: "",
        brand: "",
        size: "",
        image: "",
        description: "",
        lengthFt: 0,
        heightFt: 0,
        quantity: 1,
        itemType: "woodworks",
      });
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-add-line-item">
        <DialogHeader>
          <DialogTitle>Add Line Item</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Stepper - dynamic based on category */}
          <div className="flex items-center justify-between">
            {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
              <div key={s} className="flex items-center flex-1">
                <div className={`flex items-center justify-center w-8 h-8 rounded-full font-medium text-sm ${
                  s === step ? 'bg-primary text-primary-foreground' : 
                  s < step ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                }`}>
                  {s}
                </div>
                {s < totalSteps && (
                  <div className={`flex-1 h-0.5 mx-2 ${s < step ? 'bg-primary' : 'bg-muted'}`} />
                )}
              </div>
            ))}
          </div>

          {/* Step Content */}
          <div className="min-h-[200px]">
            {/* Step 1: Select Item Category Type */}
            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-1">Step 1: Select Item Type</h3>
                  <p className="text-sm text-muted-foreground">Choose what type of item you want to add</p>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {ITEM_CATEGORY_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleCategoryChange(option.value)}
                      className={`flex items-start gap-3 p-4 rounded-lg border text-left transition-colors ${
                        selectedItemCategory === option.value 
                          ? 'border-primary bg-primary/5' 
                          : 'border-border hover:border-primary/50'
                      }`}
                      data-testid={`button-category-${option.value}`}
                    >
                      <div className="flex-1">
                        <div className="font-medium">{option.label}</div>
                        <div className="text-sm text-muted-foreground">{option.description}</div>
                      </div>
                      {selectedItemCategory === option.value && (
                        <div className="text-primary font-semibold text-sm">Selected</div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 2: Select Unit Type */}
            {catalogLoading && step === 2 ? (
              <div className="flex flex-col items-center justify-center h-[200px] space-y-3">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading catalog data...</p>
              </div>
            ) : step === 2 ? (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-1">Step 2: Select Unit Type</h3>
                  <p className="text-sm text-muted-foreground">
                    Choose the type of {ITEM_CATEGORY_OPTIONS.find(o => o.value === selectedItemCategory)?.label.toLowerCase()} you're adding
                  </p>
                </div>
                
                {/* Show warning if no items available for this combination */}
                {unitTypes.length === 0 && !catalogLoading && (
                  <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
                    <CardContent className="p-4">
                      <p className="text-sm text-amber-700 dark:text-amber-300">
                        <strong>No catalog items found</strong> for {effectiveCategory?.replace('DeX - ', '')} 
                        {selectedItemCategory === "woodworks" && roomType ? ` with "${roomType}" room type` : ''}.
                      </p>
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                        This may be a catalog limitation. Please check if items exist in your Google Sheets catalog.
                      </p>
                    </CardContent>
                  </Card>
                )}

                <div className="space-y-2">
                  <Label htmlFor="unitType">Unit Type</Label>
                  <Select
                    value={formData.unitType}
                    onValueChange={(value) => setFormData({ ...formData, unitType: value, finish: "", handle: "", handleFinish: "", brand: "", size: "", image: "", description: "" })}
                    disabled={unitTypes.length === 0}
                  >
                    <SelectTrigger id="unitType" data-testid="select-unit-type">
                      <SelectValue placeholder={unitTypes.length === 0 ? "No unit types available" : "Select unit type"} />
                    </SelectTrigger>
                    <SelectContent className="max-w-[500px]">
                      {unitTypes.map((type) => (
                        <SelectItem key={type} value={type} className="max-w-[480px]">
                          <span className="truncate block">{type}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}

            {/* Step 3 for Accessories: Brand selection */}
            {!catalogLoading && step === 3 && isAccessoriesCategory && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-1">Step 3: Select Brand</h3>
                  <p className="text-sm text-muted-foreground">Choose the brand for this accessory</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="brand">Brand</Label>
                  <Select
                    value={formData.brand || ""}
                    onValueChange={(value) => setFormData({ ...formData, brand: value, description: "" })}
                    disabled={brands.length === 0}
                  >
                    <SelectTrigger id="brand" data-testid="select-brand">
                      <SelectValue placeholder={brands.length === 0 ? "No brands available" : "Select brand"} />
                    </SelectTrigger>
                    <SelectContent className="max-w-[500px]">
                      {brands.map((b) => (
                        <SelectItem key={b} value={b} className="max-w-[480px]">
                          <span className="truncate block">{b}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Step 4 for Accessories: Description selection */}
            {!catalogLoading && step === 4 && isAccessoriesCategory && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-1">Step 4: Select Description</h3>
                  <p className="text-sm text-muted-foreground">Choose the specific accessory</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Select
                    value={formData.description}
                    onValueChange={(value) => setFormData({ ...formData, description: value })}
                  >
                    <SelectTrigger id="description" data-testid="select-description">
                      <SelectValue placeholder="Select description" />
                    </SelectTrigger>
                    <SelectContent className="max-w-[600px] max-h-[300px]">
                      {descriptions.length === 0 ? (
                        <div className="p-4 text-sm text-muted-foreground text-center">
                          No items available for this brand
                        </div>
                      ) : (
                        descriptions.map((desc) => (
                          <SelectItem key={desc} value={desc} className="max-w-[580px]">
                            <span className="line-clamp-2 whitespace-normal text-sm">{desc}</span>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Step 5 for Accessories: Quantity */}
            {!catalogLoading && step === 5 && isAccessoriesCategory && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-1">Step 5: Enter Quantity</h3>
                  <p className="text-sm text-muted-foreground">Specify how many units you need</p>
                </div>
                <div className="max-w-xs">
                  <div className="space-y-2">
                    <Label htmlFor="quantity">Quantity</Label>
                    <Input
                      id="quantity"
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={formData.quantity || ''}
                      onChange={(e) => setFormData({ ...formData, quantity: parseFloat(e.target.value) || 1 })}
                      placeholder="1"
                      className="text-right font-mono"
                      data-testid="input-quantity"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Step 3 for Handles: Size selection */}
            {!catalogLoading && step === 3 && isHandlesCategory && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-1">Step 3: Select Size</h3>
                  <p className="text-sm text-muted-foreground">Choose the size for this handle</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="size">Size</Label>
                  <Select
                    value={formData.size || ""}
                    onValueChange={(value) => setFormData({ ...formData, size: value, handleFinish: "", image: "", description: "" })}
                    disabled={sizes.length === 0}
                  >
                    <SelectTrigger id="size" data-testid="select-size">
                      <SelectValue placeholder={sizes.length === 0 ? "No sizes available" : "Select size"} />
                    </SelectTrigger>
                    <SelectContent className="max-w-[500px]">
                      {sizes.map((s) => (
                        <SelectItem key={s} value={s} className="max-w-[480px]">
                          <span className="truncate block">{s}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Handles: Finish selection (dynamic step) */}
            {!catalogLoading && step === hStep.finish && isHandlesCategory && hasHandleFinishes && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-1">Step {hStep.finish}: Select Finish</h3>
                  <p className="text-sm text-muted-foreground">Choose the finish type for this handle</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="handleFinish">Finish</Label>
                  <Select
                    value={formData.handleFinish || ""}
                    onValueChange={(value) => setFormData({ ...formData, handleFinish: value, image: "", description: "" })}
                    disabled={handleFinishes.length === 0}
                  >
                    <SelectTrigger id="handleFinish" data-testid="select-handle-finish">
                      <SelectValue placeholder={handleFinishes.length === 0 ? "No finishes available" : "Select finish"} />
                    </SelectTrigger>
                    <SelectContent className="max-w-[500px]">
                      {handleFinishes.map((f) => (
                        <SelectItem key={f} value={f} className="max-w-[480px]">
                          <span className="truncate block">{f}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Handles: Image selection (dynamic step) */}
            {!catalogLoading && step === hStep.image && isHandlesCategory && hasImages && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-1">Step {hStep.image}: Select Product Image</h3>
                  <p className="text-sm text-muted-foreground">Choose the specific handle product</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {images.map((imageUrl) => {
                    const itemForImage = itemsForHandleFinish.find(item => item.imageUrl === imageUrl);
                    const isSelected = formData.image === imageUrl;
                    return (
                      <div
                        key={imageUrl}
                        className={`relative cursor-pointer rounded-lg border-2 p-2 transition-all ${
                          isSelected 
                            ? 'border-primary bg-primary/5' 
                            : 'border-muted hover:border-primary/50'
                        }`}
                        onClick={() => {
                          const matchedItem = itemsForHandleFinish.find(item => item.imageUrl === imageUrl);
                          setFormData({ 
                            ...formData, 
                            image: imageUrl,
                            description: matchedItem?.description || ""
                          });
                        }}
                        data-testid={`image-option-${imageUrl.slice(-20)}`}
                      >
                        <div className="aspect-square overflow-hidden rounded-md bg-muted">
                          <img 
                            src={imageUrl} 
                            alt={itemForImage?.description || 'Handle product'} 
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                              target.parentElement!.innerHTML = '<div class="flex h-full items-center justify-center text-muted-foreground text-xs">No image</div>';
                            }}
                          />
                        </div>
                        {itemForImage && (
                          <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
                            {itemForImage.description}
                          </p>
                        )}
                        {isSelected && (
                          <div className="absolute top-1 right-1 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                            <Check className="h-3 w-3 text-primary-foreground" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Handles: Description selection (dynamic step, no images variant) */}
            {!catalogLoading && step === hStep.desc && isHandlesCategory && !hasImages && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-1">Step {hStep.desc}: Select Handle</h3>
                  <p className="text-sm text-muted-foreground">Choose the specific handle</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Select
                    value={formData.description}
                    onValueChange={(value) => setFormData({ ...formData, description: value })}
                  >
                    <SelectTrigger id="description" data-testid="select-description">
                      <SelectValue placeholder="Select handle" />
                    </SelectTrigger>
                    <SelectContent className="max-w-[600px] max-h-[300px]">
                      {descriptions.length === 0 ? (
                        <div className="p-4 text-sm text-muted-foreground text-center">
                          No handles available for this selection
                        </div>
                      ) : (
                        descriptions.map((desc) => (
                          <SelectItem key={desc} value={desc} className="max-w-[580px]">
                            <span className="line-clamp-2 whitespace-normal text-sm">{desc}</span>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Handles: Description confirm (dynamic step, images variant) */}
            {!catalogLoading && step === hStep.desc && isHandlesCategory && hasImages && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-1">Step {hStep.desc}: Confirm Selection</h3>
                  <p className="text-sm text-muted-foreground">Review your selected handle</p>
                </div>
                <div className="space-y-4">
                  {formData.image && (
                    <div className="flex gap-4 items-start">
                      <div className="w-24 h-24 rounded-md overflow-hidden bg-muted shrink-0">
                        <img 
                          src={formData.image} 
                          alt="Selected handle" 
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="flex-1">
                        <Label className="text-muted-foreground text-xs">Selected Handle</Label>
                        <p className="text-sm font-medium">{formData.description}</p>
                        {selectedItem && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Size: {formData.size}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Handles: Quantity (dynamic step) */}
            {!catalogLoading && step === hStep.qty && isHandlesCategory && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-1">Step {hStep.qty}: Enter Quantity</h3>
                  <p className="text-sm text-muted-foreground">Specify how many handles you need</p>
                </div>
                <div className="max-w-xs">
                  <div className="space-y-2">
                    <Label htmlFor="quantity">Quantity</Label>
                    <Input
                      id="quantity"
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={formData.quantity || ''}
                      onChange={(e) => setFormData({ ...formData, quantity: parseFloat(e.target.value) || 1 })}
                      placeholder="1"
                      className="text-right font-mono"
                      data-testid="input-quantity"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Step 3 for Woodwork: Finish selection */}
            {!catalogLoading && step === 3 && isWoodworksCategory && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-1">Step 3: Select Finish</h3>
                  <p className="text-sm text-muted-foreground">Choose the finish type</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="finish">Finish</Label>
                  <Select
                    value={formData.finish || ""}
                    onValueChange={(value) => setFormData({ ...formData, finish: value, handle: "", description: "" })}
                    disabled={finishes.length === 0}
                  >
                    <SelectTrigger id="finish" data-testid="select-finish">
                      <SelectValue placeholder={finishes.length === 0 ? "No finishes available" : "Select finish"} />
                    </SelectTrigger>
                    <SelectContent className="max-w-[500px]">
                      {finishes.map((f) => (
                        <SelectItem key={f} value={f} className="max-w-[480px]">
                          <span className="truncate block">{f}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Step 4 for Woodwork with Handles: Handle selection */}
            {!catalogLoading && step === 4 && isWoodworksCategory && hasHandles && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-1">Step 4: Select Handle</h3>
                  <p className="text-sm text-muted-foreground">Choose the handle type</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="handle">Handle</Label>
                  <Select
                    value={formData.handle || ""}
                    onValueChange={(value) => setFormData({ ...formData, handle: value, description: "" })}
                    disabled={handles.length === 0}
                  >
                    <SelectTrigger id="handle" data-testid="select-handle">
                      <SelectValue placeholder={handles.length === 0 ? "No handles available" : "Select handle"} />
                    </SelectTrigger>
                    <SelectContent className="max-w-[500px]">
                      {handles.map((h) => (
                        <SelectItem key={h} value={h} className="max-w-[480px]">
                          <span className="truncate block">{h}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Step 5 for Woodwork with Handles: Description */}
            {!catalogLoading && step === 5 && isWoodworksCategory && hasHandles && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-1">Step 5: Select Description</h3>
                  <p className="text-sm text-muted-foreground">Choose the specific item description</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Select
                    value={formData.description}
                    onValueChange={(value) => setFormData({ ...formData, description: value })}
                  >
                    <SelectTrigger id="description" data-testid="select-description">
                      <SelectValue placeholder="Select description" />
                    </SelectTrigger>
                    <SelectContent className="max-w-[600px] max-h-[300px]">
                      {descriptions.length === 0 ? (
                        <div className="p-4 text-sm text-muted-foreground text-center">
                          No items available for this finish and handle
                        </div>
                      ) : (
                        descriptions.map((desc) => (
                          <SelectItem key={desc} value={desc} className="max-w-[580px]">
                            <span className="line-clamp-2 whitespace-normal text-sm">{desc}</span>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Step 4 for Woodwork without Handles: Description (skips Handle step) */}
            {!catalogLoading && step === 4 && isWoodworksCategory && !hasHandles && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-1">Step 4: Select Description</h3>
                  <p className="text-sm text-muted-foreground">Choose the specific item description</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Select
                    value={formData.description}
                    onValueChange={(value) => setFormData({ ...formData, description: value })}
                  >
                    <SelectTrigger id="description" data-testid="select-description">
                      <SelectValue placeholder="Select description" />
                    </SelectTrigger>
                    <SelectContent className="max-w-[600px] max-h-[300px]">
                      {descriptions.length === 0 ? (
                        <div className="p-4 text-sm text-muted-foreground text-center">
                          No items available for this finish
                        </div>
                      ) : (
                        descriptions.map((desc) => (
                          <SelectItem key={desc} value={desc} className="max-w-[580px]">
                            <span className="line-clamp-2 whitespace-normal text-sm">{desc}</span>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Step 3 for Services/Lights/Stone: Description selection */}
            {!catalogLoading && step === 3 && !isWoodworksCategory && !isAccessoriesCategory && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-1">Step 3: Select Description</h3>
                  <p className="text-sm text-muted-foreground">Choose the specific item description</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Select
                    value={formData.description}
                    onValueChange={(value) => setFormData({ ...formData, description: value })}
                  >
                    <SelectTrigger id="description" data-testid="select-description">
                      <SelectValue placeholder="Select description" />
                    </SelectTrigger>
                    <SelectContent className="max-w-[600px] max-h-[300px]">
                      {descriptions.length === 0 ? (
                        <div className="p-4 text-sm text-muted-foreground text-center">
                          No items available for this unit type
                        </div>
                      ) : (
                        descriptions.map((desc) => (
                          <SelectItem key={desc} value={desc} className="max-w-[580px]">
                            <span className="line-clamp-2 whitespace-normal text-sm">{desc}</span>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Dimensions Step for Woodwork with handles: Step 6 */}
            {!catalogLoading && isWoodworksCategory && hasHandles && step === 6 && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-1">Step 6: Enter Dimensions</h3>
                  <p className="text-sm text-muted-foreground">Provide measurements and quantity</p>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="length">Length (ft)</Label>
                    <Input
                      id="length"
                      type="number"
                      min="0.25"
                      step="0.25"
                      value={formData.lengthFt || ''}
                      onChange={(e) => {
                        const raw = parseFloat(e.target.value);
                        setFormData({ ...formData, lengthFt: isNaN(raw) ? 0 : raw });
                      }}
                      onBlur={() => {
                        if (formData.lengthFt > 0) {
                          setFormData({ ...formData, lengthFt: Math.round(formData.lengthFt * 4) / 4 });
                        }
                      }}
                      placeholder="0"
                      className="text-right font-mono"
                      data-testid="input-length"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="height">Height (ft)</Label>
                    <Input
                      id="height"
                      type="number"
                      min="0.25"
                      step="0.25"
                      value={formData.heightFt || ''}
                      onChange={(e) => {
                        const raw = parseFloat(e.target.value);
                        setFormData({ ...formData, heightFt: isNaN(raw) ? 0 : raw });
                      }}
                      onBlur={() => {
                        if (formData.heightFt > 0) {
                          setFormData({ ...formData, heightFt: Math.round(formData.heightFt * 4) / 4 });
                        }
                      }}
                      placeholder="0"
                      className="text-right font-mono"
                      data-testid="input-height"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="quantity">Quantity</Label>
                    <Input
                      id="quantity"
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={formData.quantity || ''}
                      onChange={(e) => setFormData({ ...formData, quantity: parseFloat(e.target.value) || 1 })}
                      placeholder="1"
                      className="text-right font-mono"
                      data-testid="input-quantity"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Dimensions Step for Woodwork without handles: Step 5 */}
            {!catalogLoading && isWoodworksCategory && !hasHandles && step === 5 && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-1">Step 5: Enter Dimensions</h3>
                  <p className="text-sm text-muted-foreground">Provide measurements and quantity</p>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="length">Length (ft)</Label>
                    <Input
                      id="length"
                      type="number"
                      min="0.25"
                      step="0.25"
                      value={formData.lengthFt || ''}
                      onChange={(e) => {
                        const raw = parseFloat(e.target.value);
                        setFormData({ ...formData, lengthFt: isNaN(raw) ? 0 : raw });
                      }}
                      onBlur={() => {
                        if (formData.lengthFt > 0) {
                          setFormData({ ...formData, lengthFt: Math.round(formData.lengthFt * 4) / 4 });
                        }
                      }}
                      placeholder="0"
                      className="text-right font-mono"
                      data-testid="input-length"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="height">Height (ft)</Label>
                    <Input
                      id="height"
                      type="number"
                      min="0.25"
                      step="0.25"
                      value={formData.heightFt || ''}
                      onChange={(e) => {
                        const raw = parseFloat(e.target.value);
                        setFormData({ ...formData, heightFt: isNaN(raw) ? 0 : raw });
                      }}
                      onBlur={() => {
                        if (formData.heightFt > 0) {
                          setFormData({ ...formData, heightFt: Math.round(formData.heightFt * 4) / 4 });
                        }
                      }}
                      placeholder="0"
                      className="text-right font-mono"
                      data-testid="input-height"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="quantity">Quantity</Label>
                    <Input
                      id="quantity"
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={formData.quantity || ''}
                      onChange={(e) => setFormData({ ...formData, quantity: parseFloat(e.target.value) || 1 })}
                      placeholder="1"
                      className="text-right font-mono"
                      data-testid="input-quantity"
                    />
                  </div>
                </div>
              </div>
            )}


            {/* Quantity Step for Services/Lights/Stone: Step 4 */}
            {!catalogLoading && !isWoodworksCategory && !isAccessoriesCategory && !isHandlesCategory && step === 4 && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-1">Step 4: Enter Quantity</h3>
                  <p className="text-sm text-muted-foreground">Specify how many units you need</p>
                </div>
                <div className="max-w-xs">
                  <div className="space-y-2">
                    <Label htmlFor="quantity">Quantity</Label>
                    <Input
                      id="quantity"
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={formData.quantity || ''}
                      onChange={(e) => setFormData({ ...formData, quantity: parseFloat(e.target.value) || 1 })}
                      placeholder="1"
                      className="text-right font-mono"
                      data-testid="input-quantity"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Review Step: Step 5 for non-woodwork, Step 6 for woodwork */}
            {!catalogLoading && step === totalSteps && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-1">Step {totalSteps}: Review & Confirm</h3>
                  <p className="text-sm text-muted-foreground">Verify the calculated values</p>
                </div>
                <Card>
                  <CardContent className="pt-6 space-y-3">
                    {/* Product Image (if available) */}
                    {selectedItem?.imageUrl && (
                      <div className="flex justify-center mb-4">
                        <img 
                          src={selectedItem.imageUrl} 
                          alt={formData.description}
                          className="max-h-32 max-w-full object-contain rounded-lg border"
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-muted-foreground">Description:</span>
                        <p className="font-medium">{formData.description}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Unit Type:</span>
                        <p className="font-medium">{formData.unitType}</p>
                      </div>
                      {isWoodworksCategory && formData.finish && (
                        <div>
                          <span className="text-muted-foreground">Finish:</span>
                          <p className="font-medium text-sm">{formData.finish}</p>
                        </div>
                      )}
                      {isWoodworksCategory && formData.handle && (
                        <div>
                          <span className="text-muted-foreground">Handle:</span>
                          <p className="font-medium text-sm">{formData.handle}</p>
                        </div>
                      )}
                      {isHandlesCategory && formData.size && (
                        <div>
                          <span className="text-muted-foreground">Size:</span>
                          <p className="font-medium text-sm">{formData.size}</p>
                        </div>
                      )}
                      {isHandlesCategory && formData.handleFinish && (
                        <div>
                          <span className="text-muted-foreground">Finish:</span>
                          <p className="font-medium text-sm">{formData.handleFinish}</p>
                        </div>
                      )}
                      {isWoodworksCategory && (
                        <div>
                          <span className="text-muted-foreground">Dimensions:</span>
                          <p className="font-mono font-medium">{formData.lengthFt} × {formData.heightFt} ft</p>
                        </div>
                      )}
                      <div>
                        <span className="text-muted-foreground">Quantity:</span>
                        <p className="font-mono font-medium">{formData.quantity}</p>
                      </div>
                    </div>
                    <div className="pt-3 border-t">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold">Total Amount:</span>
                        <span className="font-mono font-bold text-xl text-primary" data-testid="text-preview-amount">
                          ₹{Math.round(amount).toLocaleString('en-IN')}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={handleBack}
              disabled={step === 1}
              data-testid="button-back"
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            {step < totalSteps ? (
              <Button
                type="button"
                onClick={handleNext}
                disabled={!isStepValid()}
                data-testid="button-next"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                data-testid="button-add-item"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Adding...
                  </>
                ) : (
                  "Add Line Item"
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
