import ProjectCard from '../ProjectCard';

export default function ProjectCardExample() {
  return (
    <div className="p-6 space-y-4 max-w-sm">
      <ProjectCard
        id="1"
        clientName="Rajesh Kumar"
        projectType="Residential"
        status="Generated"
        totalQuotes={4}
        lastUpdated={new Date(Date.now() - 2 * 60 * 60 * 1000)}
        onClick={() => console.log('Project clicked')}
      />
      <ProjectCard
        id="2"
        clientName="Green Valley Apartments"
        projectType="Commercial"
        status="Draft"
        totalQuotes={12}
        lastUpdated={new Date(Date.now() - 24 * 60 * 60 * 1000)}
        onClick={() => console.log('Project clicked')}
      />
    </div>
  );
}
