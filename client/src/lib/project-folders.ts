import type { Project } from "@/lib/types";

export function normalizePid(pid: string | null | undefined): string {
  return pid?.trim().toLowerCase() || "";
}

export function findLatestPidForClient(projects: Project[], clientId: string): string {
  return projects
    .filter(project => project.clientId === clientId && normalizePid(project.pid))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]
    ?.pid?.trim() || "";
}

export interface ProjectFolderGroup<T extends Project = Project> {
  key: string;
  pid: string | null;
  projects: T[];
  latestUpdatedAt: Date;
}

export function groupProjectsByPid<T extends Project>(projects: T[]): ProjectFolderGroup<T>[] {
  const groups = new Map<string, ProjectFolderGroup<T>>();

  for (const project of projects) {
    const pid = project.pid?.trim() || null;
    const normalizedPid = normalizePid(pid);
    const key = normalizedPid ? `pid:${normalizedPid}` : `legacy:${project.id}`;
    const updatedAt = new Date(project.updatedAt);
    const existing = groups.get(key);

    if (existing) {
      existing.projects.push(project);
      if (updatedAt > existing.latestUpdatedAt) existing.latestUpdatedAt = updatedAt;
    } else {
      groups.set(key, {
        key,
        pid,
        projects: [project],
        latestUpdatedAt: updatedAt,
      });
    }
  }

  return Array.from(groups.values()).sort(
    (a, b) => b.latestUpdatedAt.getTime() - a.latestUpdatedAt.getTime(),
  );
}