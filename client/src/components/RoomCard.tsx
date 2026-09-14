import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, ChevronRight, MoreVertical, Trash2, Copy, Pencil } from "lucide-react";

export interface RoomCardProps {
  id: string;
  roomName: string;
  roomType: "Wet / Exposed" | "Dry / Inexposed";
  unitGroupName?: string;
  itemCount: number;
  totalAmount: number;
  onClick?: () => void;
  onAddLineItem?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  isFinalized?: boolean;
}

export default function RoomCard({
  roomName,
  roomType,
  unitGroupName,
  itemCount,
  totalAmount,
  onClick,
  onAddLineItem,
  onEdit,
  onDelete,
  onDuplicate,
  isFinalized = false,
}: RoomCardProps) {
  return (
    <Card 
      className="hover-elevate active-elevate-2 cursor-pointer"
      data-testid={`card-room-${roomName.toLowerCase().replace(/\s/g, '-')}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0 cursor-pointer" onClick={onClick}>
            <h3 className="font-semibold text-lg truncate" data-testid="text-room-name">
              {roomName}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="text-xs" data-testid="badge-room-type">
                {roomType}
              </Badge>
              {unitGroupName && (
                <span className="text-xs text-muted-foreground" data-testid="text-unit-group">
                  {unitGroupName}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {!isFinalized && (onEdit || onDelete || onDuplicate) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8"
                    onClick={(e) => e.stopPropagation()}
                    data-testid="button-room-actions"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {onEdit && (
                    <DropdownMenuItem 
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit();
                      }}
                      data-testid="button-edit-room"
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit Room Name
                    </DropdownMenuItem>
                  )}
                  {onDuplicate && (
                    <DropdownMenuItem 
                      onClick={(e) => {
                        e.stopPropagation();
                        onDuplicate();
                      }}
                      data-testid="button-duplicate-room"
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Duplicate Room
                    </DropdownMenuItem>
                  )}
                  {onDelete && (
                    <DropdownMenuItem 
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                      }}
                      className="text-destructive focus:text-destructive"
                      data-testid="button-delete-room"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Room
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <ChevronRight className="h-5 w-5 text-muted-foreground cursor-pointer" onClick={onClick} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {itemCount} {itemCount === 1 ? 'item' : 'items'}
          </span>
          <span className="font-mono font-semibold" data-testid="text-room-total">
            ₹{Math.round(totalAmount).toLocaleString('en-IN')}
          </span>
        </div>
        {!isFinalized && (
          <Button 
            size="sm" 
            variant="outline" 
            className="w-full"
            onClick={(e) => {
              e.stopPropagation();
              onAddLineItem?.();
            }}
            data-testid="button-add-line-item"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Line Item
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
