import { useState } from 'react';
import AddLineItemWizard from '../AddLineItemWizard';
import { Button } from '@/components/ui/button';

export default function AddLineItemWizardExample() {
  const [open, setOpen] = useState(true);

  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)}>Open Wizard</Button>
      <AddLineItemWizard
        open={open}
        onOpenChange={setOpen}
        onSubmit={(data) => console.log('Line item created:', data)}
      />
    </div>
  );
}
