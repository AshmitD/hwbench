import { useProjectStore } from './store/projectStore';
import WorkbenchApp from './components/Workbench/WorkbenchApp';
import LandingPage from './components/LandingPage/LandingPage';

function App() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  return activeProjectId ? <WorkbenchApp /> : <LandingPage />;
}

export default App;
