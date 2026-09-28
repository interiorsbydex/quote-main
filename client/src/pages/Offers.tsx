import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Gift, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Offer = {
  id: string;
  name: string;
  productCategory: string;
  offerType: "percentage" | "cash";
  percentageValue: number | null;
  cashValue: number | null;
  minWoodworkValue: number;
  maxWoodworkValue: number | null;
  isActive: boolean;
};

const money = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;

export default function Offers() {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [offerType, setOfferType] = useState<Offer["offerType"]>("percentage");
  const [percentageValue, setPercentageValue] = useState("");
  const [cashValue, setCashValue] = useState("");
  const [minWoodworkValue, setMinWoodworkValue] = useState("0");
  const [maxWoodworkValue, setMaxWoodworkValue] = useState("");

  const { data: offers = [], isLoading } = useQuery<Offer[]>({ queryKey: ["/api/admin/offers"] });

  const createOffer = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/admin/offers", {
        name,
        offerType,
        percentageValue: offerType === "percentage" ? Number(percentageValue) : null,
        cashValue: offerType === "cash" ? Number(cashValue) : null,
        minWoodworkValue: Number(minWoodworkValue || 0),
        maxWoodworkValue: maxWoodworkValue.trim() ? Number(maxWoodworkValue) : null,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/offers"] });
      setName("");
      setPercentageValue("");
      setCashValue("");
      setMinWoodworkValue("0");
      setMaxWoodworkValue("");
      toast({ title: "Offer created", description: "Designers can select it when their project's Woodwork value is eligible." });
    },
    onError: (error: Error) => toast({ title: "Offer not created", description: error.message, variant: "destructive" }),
  });

  const toggleOffer = useMutation({
    mutationFn: async (offer: Offer) => {
      const response = await apiRequest("PATCH", `/api/admin/offers/${offer.id}`, { ...offer, isActive: !offer.isActive });
      return response.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/offers"] }),
    onError: (error: Error) => toast({ title: "Offer not updated", description: error.message, variant: "destructive" }),
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            <Link href="/admin"><Button variant="ghost" size="icon" data-testid="button-back-admin"><ArrowLeft className="h-5 w-5" /></Button></Link>
            <div>
              <h1 className="text-xl font-semibold">Offers</h1>
              <p className="text-xs text-muted-foreground">Quote-level promotions</p>
            </div>
          </div>
          <Link href="/"><Button variant="outline" size="sm">View Projects</Button></Link>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl space-y-6 px-4 py-8 md:px-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> Create Offer</CardTitle>
            <CardDescription>
              Offers use the <strong>Offer Product</strong> category and become available when a project’s Woodwork value (after discount and before GST) is within the selected range.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="offer-name">Offer name</Label>
                <Input id="offer-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Festival Savings" data-testid="input-offer-name" />
              </div>
              <div className="space-y-2">
                <Label>Offer type</Label>
                <Select value={offerType} onValueChange={(value: Offer["offerType"]) => setOfferType(value)}>
                  <SelectTrigger data-testid="select-offer-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage Discount</SelectItem>
                    <SelectItem value="cash">Cash Discount</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {offerType === "percentage" ? (
                <div className="space-y-2">
                  <Label htmlFor="offer-percentage">Discount percentage</Label>
                  <Input id="offer-percentage" type="number" min="0.01" max="100" step="0.01" value={percentageValue} onChange={(event) => setPercentageValue(event.target.value)} placeholder="e.g. 5" data-testid="input-offer-percentage" />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="offer-cash">Cash discount (₹)</Label>
                  <Input id="offer-cash" type="number" min="1" value={cashValue} onChange={(event) => setCashValue(event.target.value)} placeholder="e.g. 50000" data-testid="input-offer-cash" />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="offer-minimum">Minimum Woodwork value (after discount and before GST) (₹)</Label>
                <Input id="offer-minimum" type="number" min="0" value={minWoodworkValue} onChange={(event) => setMinWoodworkValue(event.target.value)} data-testid="input-offer-minimum" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="offer-maximum">Maximum Woodwork value (after discount and before GST) (₹, optional)</Label>
                <Input id="offer-maximum" type="number" min="0" value={maxWoodworkValue} onChange={(event) => setMaxWoodworkValue(event.target.value)} placeholder="No maximum" data-testid="input-offer-maximum" />
              </div>
            </div>
            <Button
              onClick={() => createOffer.mutate()}
              disabled={!name.trim() || createOffer.isPending || (offerType === "percentage" ? !(Number(percentageValue) > 0) : !(Number(cashValue) > 0))}
              data-testid="button-create-offer"
            >
              {createOffer.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Gift className="mr-2 h-4 w-4" />}
              Create Offer
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Configured Offers</CardTitle>
            <CardDescription>Deactivate an offer to stop new applications. Offers already selected on draft quotations remain visible so they can be removed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? <div className="py-6 text-center text-muted-foreground">Loading offers…</div> : offers.length === 0 ? (
              <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">No offers have been created yet.</div>
            ) : offers.map((offer) => (
              <div key={offer.id} className="flex flex-col justify-between gap-3 rounded-lg border p-4 sm:flex-row sm:items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{offer.name}</p>
                    <Badge variant="secondary">{offer.productCategory}</Badge>
                    {!offer.isActive && <Badge variant="outline">Inactive</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {offer.offerType === "percentage" ? `${offer.percentageValue}% after GST` : `${money(offer.cashValue || 0)} after GST`}
                    {" · "}Woodwork value: {money(offer.minWoodworkValue)}{offer.maxWoodworkValue === null ? "+" : ` – ${money(offer.maxWoodworkValue)}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`offer-active-${offer.id}`} className="text-sm">Active</Label>
                  <Switch id={`offer-active-${offer.id}`} checked={offer.isActive} onCheckedChange={() => toggleOffer.mutate(offer)} disabled={toggleOffer.isPending} data-testid={`switch-offer-active-${offer.id}`} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}