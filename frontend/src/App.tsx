import { useHardwareSocket } from './hooks/useHardwareSocket';
import Layout from './components/Layout/Layout';
import CodeContextPanel from './components/CodeContext/CodeContextPanel';
import HardwarePanel from './components/Hardware/HardwarePanel';
import DebugOverlay from './components/DebugOverlay/DebugOverlay';

function App() {
  useHardwareSocket();

  return (
    <>
      <Layout
        left={<CodeContextPanel />}
        center={<HardwarePanel />}
      />
      <DebugOverlay />
    </>
  );
}

export default App;
