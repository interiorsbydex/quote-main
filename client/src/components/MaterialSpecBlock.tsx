import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface MaterialSpec {
  coreMaterial?: string;
  finishMaterial?: string;
  hinges?: string;
  brand?: string;
  laminateType?: string;
}

export interface MaterialSpecBlockProps {
  category: string; // Accepts DeX categories or legacy categories
  specs: MaterialSpec;
}

export default function MaterialSpecBlock({ category, specs }: MaterialSpecBlockProps) {
  const specItems = [
    { label: "Core Material", value: specs.coreMaterial },
    { label: "Finish Material", value: specs.finishMaterial },
    { label: "Hinges", value: specs.hinges },
    { label: "Brand", value: specs.brand },
    { label: "Laminate Type", value: specs.laminateType },
  ].filter(item => item.value);

  return (
    <Card className="bg-muted/50" data-testid="card-material-spec">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Material Specification</CardTitle>
          <Badge variant="outline" data-testid="badge-category">{category}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {specItems.map((item, index) => (
            <div key={index} className="flex items-baseline gap-2">
              <span className="text-sm font-medium text-muted-foreground min-w-[120px]">
                {item.label}:
              </span>
              <span className="text-sm font-medium" data-testid={`text-${item.label.toLowerCase().replace(/\s/g, '-')}`}>
                {item.value}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
