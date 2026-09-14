import { useState } from 'react';
import CreateProjectDialog from '../CreateProjectDialog';
import { Button } from '@/components/ui/button';

export default function CreateProjectDialogExample() {
  const [open, setOpen] = useState(true);

  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)}>Open Dialog</Button>
      <CreateProjectDialog
        open={open}
        onOpenChange={setOpen}
        onSubmit={(data) => console.log('Project created:', data)}
      />
    </div>
  );
}
