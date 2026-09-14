import LineItemRow from '../LineItemRow';
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function LineItemRowExample() {
  const sampleItem = {
    id: "1",
    description: "Base Storage Unit - Modular Kitchen",
    lengthFt: 8,
    heightFt: 3,
    sqft: 24,
    lengthMm: 2400,
    heightMm: 900,
    rate: 1500,
    quantity: 2,
    amount: 72000
  };

  return (
    <div className="p-6">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Length (ft)</TableHead>
            <TableHead className="text-right">Height (ft)</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <LineItemRow
            item={sampleItem}
            onEdit={() => console.log('Edit clicked')}
            onDelete={() => console.log('Delete clicked')}
          />
        </TableBody>
      </Table>
    </div>
  );
}
