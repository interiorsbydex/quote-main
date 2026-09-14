import MaterialSpecBlock from '../MaterialSpecBlock';

export default function MaterialSpecBlockExample() {
  return (
    <div className="p-6 max-w-2xl">
      <MaterialSpecBlock
        category="Premium"
        specs={{
          coreMaterial: "Plywood",
          finishMaterial: "Laminate",
          hinges: "Hettich",
          brand: "Greenply",
          laminateType: "Matte Finish"
        }}
      />
    </div>
  );
}
