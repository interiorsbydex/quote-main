import RoomCard from '../RoomCard';

export default function RoomCardExample() {
  return (
    <div className="p-6 space-y-4 max-w-sm">
      <RoomCard
        id="1"
        roomName="Master Bedroom"
        roomType="Dry / Inexposed"
        unitGroupName="Wardrobe Units"
        itemCount={3}
        totalAmount={125000}
        onClick={() => console.log('Room clicked')}
        onAddLineItem={() => console.log('Add line item clicked')}
      />
      <RoomCard
        id="2"
        roomName="Kitchen"
        roomType="Wet / Exposed"
        itemCount={5}
        totalAmount={280000}
        onClick={() => console.log('Room clicked')}
        onAddLineItem={() => console.log('Add line item clicked')}
      />
    </div>
  );
}
