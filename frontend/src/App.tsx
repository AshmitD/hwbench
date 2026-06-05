import { useHardwareSocket } from './hooks/useHardwareSocket';
import { useAppStore } from './store/appStore';
import Layout from './components/Layout/Layout';
import Dashboard from './components/Dashboard/Dashboard';
import OscilloscopePanel from './components/Panels/OscilloscopePanel';
import ProtocolPanel from './components/Panels/ProtocolPanel';
import FuncGenPanel from './components/Panels/FuncGenPanel';
import CodeContextPanel from './components/CodeContext/CodeContextPanel';
import DebugOverlay from './components/DebugOverlay/DebugOverlay';

function App() {
  useHardwareSocket();
  const activePanel = useAppStore(s => s.activePanel);

  const content = (() => {
    switch (activePanel) {
      case 'osc':     return <OscilloscopePanel />;
      case 'proto':   return <ProtocolPanel />;
      case 'funcgen': return <FuncGenPanel />;
      case 'code':    return <CodeContextPanel />;
      default:        return <Dashboard />;
    }
  })();

  return (
    <>
      <Layout>{content}</Layout>
      <DebugOverlay />
    </>
  );
}

export default App;
