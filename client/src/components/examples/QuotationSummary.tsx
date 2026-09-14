import QuotationSummary from '../QuotationSummary';

export default function QuotationSummaryExample() {
  return (
    <div className="p-6 max-w-sm">
      <QuotationSummary
        lineItems={[]}
        onMarkupChange={(markup) => console.log('Markup changed:', markup)}
      />
    </div>
  );
}
