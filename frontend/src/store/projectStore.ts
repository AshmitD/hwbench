import { create } from 'zustand';

export type ToolId = 'oscilloscope' | 'protocol' | 'funcgen' | 'schematic' | 'measurements' | 'ai' | 'logic-analyzer';

export interface Project {
  id: string;
  name: string;
  description: string;
  tools: ToolId[];
  createdAt: number;
  updatedAt: number;
}

interface ProjectState {
  projects: Project[];
  activeProjectId: string | null;

  createProject: (name: string, description: string, tools: ToolId[]) => Project;
  openProject: (id: string) => void;
  deleteProject: (id: string) => void;
  updateProject: (id: string, patch: Partial<Pick<Project, 'name' | 'description' | 'tools'>>) => void;

  // Assemble an AI context string from the active project
  getAiContext: () => string;
}

const STORAGE_KEY = 'hwbench_projects';
const ACTIVE_KEY  = 'hwbench_active_project';

function load(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Project[]) : [];
  } catch {
    return [];
  }
}

function save(projects: Project[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

const TOOL_LABELS: Record<ToolId, string> = {
  oscilloscope:      'Oscilloscope',
  protocol:          'Protocol Analyzer',
  funcgen:           'Function Generator',
  schematic:         'Schematic Viewer',
  measurements:      'Measurements',
  ai:                'AI Assistant',
  'logic-analyzer':  'Logic Analyzer',
};

export const useProjectStore = create<ProjectState>((setState, getState) => ({
  projects: load(),
  activeProjectId: localStorage.getItem(ACTIVE_KEY),

  createProject: (name, description, tools) => {
    const project: Project = {
      id:          crypto.randomUUID(),
      name,
      description,
      tools,
      createdAt:   Date.now(),
      updatedAt:   Date.now(),
    };
    setState((s) => {
      const projects = [...s.projects, project];
      save(projects);
      localStorage.setItem(ACTIVE_KEY, project.id);
      return { projects, activeProjectId: project.id };
    });
    return project;
  },

  openProject: (id) => {
    localStorage.setItem(ACTIVE_KEY, id);
    setState({ activeProjectId: id });
  },

  deleteProject: (id) => {
    setState((s) => {
      const projects = s.projects.filter(p => p.id !== id);
      save(projects);
      const activeProjectId = s.activeProjectId === id
        ? (projects[projects.length - 1]?.id ?? null)
        : s.activeProjectId;
      if (activeProjectId) localStorage.setItem(ACTIVE_KEY, activeProjectId);
      else localStorage.removeItem(ACTIVE_KEY);
      return { projects, activeProjectId };
    });
  },

  updateProject: (id, patch) => {
    setState((s) => {
      const projects = s.projects.map(p =>
        p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p
      );
      save(projects);
      return { projects };
    });
  },

  getAiContext: () => {
    const { projects, activeProjectId } = getState();
    const project = projects.find(p => p.id === activeProjectId);
    if (!project) return '';
    const toolList = project.tools.map(t => TOOL_LABELS[t]).join(', ');
    return [
      `Project: ${project.name}`,
      `Description: ${project.description}`,
      `Active tools: ${toolList}`,
    ].join('\n');
  },
}));
