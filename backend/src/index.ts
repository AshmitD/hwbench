import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import uploadRoutes from './routes/upload.js';
import analysisRoutes from './routes/analysis.js';
import chatRoutes from './routes/chat.js';
import githubRoutes from './routes/github.js';
import { generateFrame, MockScenario } from './services/mockHardware.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/api/files', express.static(path.join(process.cwd(), 'uploads')));

app.use('/api/upload', uploadRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/github', githubRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', message: 'HWBench backend running', mode: 'mock' });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
  console.log('[WS] Client connected');
  let scenario: MockScenario = 'motor';

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as { type?: string; scenario?: MockScenario };
      if (
        msg.type === 'set_scenario' &&
        msg.scenario &&
        ['motor', 'i2c_nack', 'driver_fault', 'noisy', 'pid', 'pwm'].includes(msg.scenario)
      ) {
        scenario = msg.scenario;
        console.log(`[WS] Scenario -> ${scenario}`);
      }
    } catch {
      // Ignore malformed client control messages.
    }
  });

  const interval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(generateFrame(scenario)));
    }
  }, 50);

  ws.on('close', () => {
    clearInterval(interval);
    console.log('[WS] Client disconnected');
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err.message);
    clearInterval(interval);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 HTTP server on http://localhost:${PORT}`);
  console.log(`🔌 WebSocket on ws://localhost:${PORT}`);
  console.log(`🎛️  Mock hardware mode active`);
});
