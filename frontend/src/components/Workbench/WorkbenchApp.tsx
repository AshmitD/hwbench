import { useHardwareSocket } from '../../hooks/useHardwareSocket';
import { useAppStore } from '../../store/appStore';
import Layout from '../Layout/Layout';
import Dashboard from '../Dashboard/Dashboard';
import OscilloscopePanel from '../Panels/OscilloscopePanel';
import ProtocolPanel from '../Panels/ProtocolPanel';
import FuncGenPanel from '../Panels/FuncGenPanel';
import CodeContextPanel from '../CodeContext/CodeContextPanel';
import DebugOverlay from '../DebugOverlay/DebugOverlay';
import LearnMoreDrawer from '../LearnMore/LearnMoreDrawer';
import LocalRunModal from '../LocalRun/LocalRunModal';
import styles from './WorkbenchApp.module.css';

export default function WorkbenchApp() {
  useHardwareSocket();
  const activePanel = useAppStore(s => s.activePanel);
  const connectionStatus = useAppStore(s => s.connectionStatus);

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
      {connectionStatus === 'disconnected' && (
        <div className={styles.backendNotice}>
          Backend not connected. Start it with <code>npm run dev:backend</code>.
        </div>
      )}
      <DebugOverlay />
      <LearnMoreDrawer />
      <LocalRunModal />
    </>
  );
}
