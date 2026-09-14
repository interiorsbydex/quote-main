import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { textMatchesCatalogSearch } from "@/lib/catalog-search";
import { cn } from "@/lib/utils";

type SearchableSelectProps = {
  value: string;
  options: string[];
  onValueChange: (value: string) => void;
  placeholder: string;
  emptyMessage?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  id?: string;
  testId?: string;
};

export default function SearchableSelect({
  value,
  options,
  onValueChange,
  placeholder,
  emptyMessage = "No options found.",
  searchPlaceholder = "Search options...",
  disabled = false,
  id,
  testId,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setSearch("");
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          id={id}
          aria-expanded={open}
          disabled={disabled}
          data-testid={testId}
          className="h-9 w-full justify-between font-normal"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value || placeholder}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[--radix-popover-trigger-width] min-w-[16rem] p-0"
      >
        <Command
          loop
          filter={(optionValue, searchValue) =>
            textMatchesCatalogSearch(optionValue, searchValue) ? 1 : 0
          }
        >
          <CommandInput
            autoFocus
            value={search}
            onValueChange={setSearch}
            placeholder={searchPlaceholder}
            autoComplete="off"
          />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option}
                  value={option}
                  onSelect={() => {
                    onValueChange(option);
                    handleOpenChange(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === option ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="whitespace-normal text-left">{option}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}