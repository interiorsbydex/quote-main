import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Search, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface CatalogItemDB {
  id: string;
  sheetRowId: number | null;
  // All 13 columns from Google Sheets (parsed values)
  projectType: string | null;
  section: string | null;
  roomType: string | null;
  unitType: string | null;
  panelType: string | null;
  categoryName: string;
  categoryNameRaw: string | null;
  materialType: string | null;
  brand: string | null;
  description: string | null;
  rate: number;
  markup: number;
  margin: number;
  sellingPrice: number;
  // RAW values from Google Sheets (exact cell values)
  roomTypeRaw: string | null;
  unitTypeRaw: string | null;
  panelTypeRaw: string | null;
  materialTypeRaw: string | null;
  brandRaw: string | null;
  rateRaw: string | null;
  markupRaw: string | null;
  marginRaw: string | null;
  sellingPriceRaw: string | null;
  // Multi-select arrays
  materials: string[];
  finishes: string[];
  specifications: string[];
  // Data quality
  hasErrors: boolean;
  errorDetails: string | null;
  isValid: boolean;
  createdAt: string;
}

interface CatalogResponse {
  items: CatalogItemDB[];
  total: number;
  limit: number;
  offset: number;
}

export default function CatalogBrowser() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [roomType, setRoomType] = useState<string>("all");
  const [page, setPage] = useState(0);
  const limit = 50;

  // Build query URL with parameters
  const buildQueryUrl = () => {
    const params = new URLSearchParams();
    if (category !== 'all') params.append('category', category);
    if (roomType !== 'all') params.append('roomType', roomType);
    if (search) params.append('search', search);
    params.append('limit', limit.toString());
    params.append('offset', (page * limit).toString());
    return `/api/admin/catalog?${params.toString()}`;
  };

  const { data, isLoading, refetch } = useQuery<CatalogResponse>({
    queryKey: ['/api/admin/catalog', category, roomType, search, page],
    queryFn: async () => {
      const response = await fetch(buildQueryUrl(), { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`Failed to fetch catalog: ${response.statusText}`);
      }
      return response.json();
    },
  });

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  const handleSearch = () => {
    setPage(0);
    refetch();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Catalog Browser</h1>
          <p className="text-muted-foreground mt-2">
            View and search all synced catalog items from Google Sheets
          </p>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
            <CardDescription>Search and filter catalog items</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Search */}
              <div className="md:col-span-2">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search description, material, or brand..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyPress={handleKeyPress}
                      className="pl-9"
                      data-testid="input-search-catalog"
                    />
                  </div>
                  <Button onClick={handleSearch} data-testid="button-search">
                    Search
                  </Button>
                </div>
              </div>

              {/* Category Filter */}
              <div>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger data-testid="select-category">
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    <SelectItem value="DeX - Xpress">Xpress</SelectItem>
                    <SelectItem value="DeX - Xpand">Xpand</SelectItem>
                    <SelectItem value="DeX - Accessories">Accessories</SelectItem>
                    <SelectItem value="DeX - Services">Services</SelectItem>
                    <SelectItem value="DeX - Lights">Lights</SelectItem>
                    <SelectItem value="DeX - Stone Master">Stone Master</SelectItem>
                    <SelectItem value="DeX - Handles">Handles</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Room Type Filter */}
              <div>
                <Select value={roomType} onValueChange={setRoomType}>
                  <SelectTrigger data-testid="select-room-type">
                    <SelectValue placeholder="All Room Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Room Types</SelectItem>
                    <SelectItem value="Wet / Exposed">Wet / Exposed</SelectItem>
                    <SelectItem value="Dry / Inexposed">Dry / Inexposed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Catalog Items</CardTitle>
                <CardDescription>
                  {data ? `Showing ${data.items.length} of ${data.total} items` : 'Loading...'}
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh">
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(10)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : data && data.items.length > 0 ? (
              <div className="space-y-4">
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16 sticky left-0 bg-background z-10">Row</TableHead>
                        <TableHead className="min-w-[100px]">Category</TableHead>
                        <TableHead className="min-w-[120px]">Project Type</TableHead>
                        <TableHead className="min-w-[100px]">Section</TableHead>
                        <TableHead className="min-w-[120px]">Room Type</TableHead>
                        <TableHead className="min-w-[100px]">Unit Type</TableHead>
                        <TableHead className="min-w-[100px]">Panel Type</TableHead>
                        <TableHead className="min-w-[120px]">Material Type</TableHead>
                        <TableHead className="min-w-[100px]">Brand</TableHead>
                        <TableHead className="min-w-[200px]">Description</TableHead>
                        <TableHead className="text-right font-mono min-w-[120px]">Selling Price</TableHead>
                        <TableHead className="min-w-[80px]">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.items.map((item) => (
                        <TableRow key={item.id} data-testid={`row-catalog-${item.id}`}>
                          <TableCell className="font-mono text-xs text-muted-foreground sticky left-0 bg-background z-10">
                            {item.sheetRowId || '-'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" data-testid={`badge-category-${item.id}`}>
                              {item.categoryName}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{item.projectType || '-'}</TableCell>
                          <TableCell className="text-sm">{item.section || '-'}</TableCell>
                          <TableCell className="text-sm">
                            {item.roomTypeRaw || item.roomType ? (
                              <Badge variant="secondary" className="text-xs">
                                {item.roomTypeRaw || item.roomType}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs italic">(empty)</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{item.unitTypeRaw || item.unitType || <span className="text-muted-foreground text-xs italic">(empty)</span>}</TableCell>
                          <TableCell className="text-sm">{item.panelType || '-'}</TableCell>
                          <TableCell className="text-sm">{item.materialType || '-'}</TableCell>
                          <TableCell className="text-sm">{item.brand || '-'}</TableCell>
                          <TableCell className="max-w-xs truncate">{item.description || '-'}</TableCell>
                          <TableCell className="text-right font-mono">{item.sellingPriceRaw || (item.sellingPrice === 0 ? <span className="text-muted-foreground text-xs italic">(empty/0)</span> : `₹${item.sellingPrice.toLocaleString()}`)}</TableCell>
                          <TableCell>
                            {item.hasErrors ? (
                              <Badge variant="destructive" className="gap-1" data-testid={`badge-error-${item.id}`}>
                                <AlertCircle className="h-3 w-3" />
                                Errors
                              </Badge>
                            ) : item.isValid ? (
                              <Badge variant="default" className="bg-green-600">
                                Valid
                              </Badge>
                            ) : (
                              <Badge variant="secondary">
                                Warnings
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                      Page {page + 1} of {totalPages}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={page === 0}
                        data-testid="button-prev-page"
                      >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={page >= totalPages - 1}
                        data-testid="button-next-page"
                      >
                        Next
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-muted-foreground">
                  No catalog items found. {data?.total === 0 ? 'Run catalog refresh to sync from Google Sheets.' : 'Try adjusting your filters.'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
