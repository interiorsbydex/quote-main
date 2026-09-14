import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { DexCategory } from "@/lib/types";

export interface AddRoomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: RoomFormData) => void;
  multiStyleEnabled?: boolean;
  projectDefaultCategory?: string; // Accepts DeX or legacy categories for backward compatibility
}

export interface RoomFormData {
  roomName: string;
  roomType: "Wet / Exposed" | "Dry / Inexposed";
  unitGroupName: string;
  category?: string; // Accepts DeX or legacy categories
}

interface FormErrors {
  roomName?: string;
}

export default function AddRoomDialog({ 
  open, 
  onOpenChange, 
  onSubmit,
  multiStyleEnabled = false,
  projectDefaultCategory = "DeX - Xpress"
}: AddRoomDialogProps) {
  const [formData, setFormData] = useState<RoomFormData>({
    roomName: "",
    roomType: "Dry / Inexposed",
    unitGroupName: "",
    category: projectDefaultCategory,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Reset form when dialog opens or project category changes
  useEffect(() => {
    if (open) {
      setFormData({
        roomName: "",
        roomType: "Dry / Inexposed",
        unitGroupName: "",
        category: projectDefaultCategory,
      });
      setErrors({});
      setTouched({});
    }
  }, [open, projectDefaultCategory]);

  const validateField = (field: string, value: string): string | undefined => {
    switch (field) {
      case 'roomName':
        if (!value.trim()) return "Room name is required";
        if (value.trim().length < 2) return "Room name must be at least 2 characters";
        if (value.trim().length > 50) return "Room name must be less than 50 characters";
        return undefined;
      default:
        return undefined;
    }
  };

  const handleFieldChange = (field: keyof RoomFormData, value: any) => {
    setFormData({ ...formData, [field]: value });
    if (touched[field]) {
      const error = validateField(field, value);
      setErrors({ ...errors, [field]: error });
    }
  };

  const handleBlur = (field: string) => {
    setTouched({ ...touched, [field]: true });
    const value = formData[field as keyof RoomFormData];
    const error = validateField(field, String(value));
    setErrors({ ...errors, [field]: error });
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};
    const roomNameError = validateField('roomName', formData.roomName);
    if (roomNameError) newErrors.roomName = roomNameError;
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ roomName: true });
    if (!validateForm()) return;
    
    // Only include category if multiStyleEnabled - otherwise let room inherit project default
    const submitData = multiStyleEnabled 
      ? { ...formData, category: formData.category || projectDefaultCategory }
      : { roomName: formData.roomName, roomType: formData.roomType, unitGroupName: formData.unitGroupName };
    onSubmit(submitData as RoomFormData);
    onOpenChange(false);
    setFormData({
      roomName: "",
      roomType: "Dry / Inexposed",
      unitGroupName: "",
      category: projectDefaultCategory,
    });
    setErrors({});
    setTouched({});
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="dialog-add-room">
        <DialogHeader>
          <DialogTitle>Add Space / Room</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="roomName">Room Name</Label>
              <Input
                id="roomName"
                value={formData.roomName}
                onChange={(e) => handleFieldChange('roomName', e.target.value)}
                onBlur={() => handleBlur('roomName')}
                placeholder="e.g., Master Bedroom, Kitchen"
                className={errors.roomName ? "border-destructive" : ""}
                data-testid="input-room-name"
              />
              {errors.roomName && touched.roomName && (
                <p className="text-sm text-destructive" data-testid="error-room-name">
                  {errors.roomName}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Room Type</Label>
              <RadioGroup 
                value={formData.roomType} 
                onValueChange={(value: any) => setFormData({ ...formData, roomType: value })}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="Wet / Exposed" id="wet" data-testid="radio-wet" />
                  <Label htmlFor="wet" className="font-normal cursor-pointer">Wet / Exposed</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="Dry / Inexposed" id="dry" data-testid="radio-dry" />
                  <Label htmlFor="dry" className="font-normal cursor-pointer">Dry / Inexposed</Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label htmlFor="unitGroupName">Unit Group Name (Optional)</Label>
              <Input
                id="unitGroupName"
                value={formData.unitGroupName}
                onChange={(e) => setFormData({ ...formData, unitGroupName: e.target.value })}
                placeholder="e.g., Wardrobe Units"
                data-testid="input-unit-group"
              />
            </div>

            {multiStyleEnabled && (
              <div className="space-y-2">
                <Label htmlFor="category">Style Category</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value: any) => setFormData({ ...formData, category: value })}
                >
                  <SelectTrigger id="category" data-testid="select-room-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DeX - Xpress">Xpress</SelectItem>
                    <SelectItem value="DeX - Xpand">Xpand</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel">
              Cancel
            </Button>
            <Button type="submit" data-testid="button-add-room">
              Add Room
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
