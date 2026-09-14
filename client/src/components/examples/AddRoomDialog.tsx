import { useState } from 'react';
import AddRoomDialog from '../AddRoomDialog';
import { Button } from '@/components/ui/button';

export default function AddRoomDialogExample() {
  const [open, setOpen] = useState(true);

  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)}>Open Dialog</Button>
      <AddRoomDialog
        open={open}
        onOpenChange={setOpen}
        onSubmit={(data) => console.log('Room created:', data)}
        multiStyleEnabled={true}
      />
    </div>
  );
}
