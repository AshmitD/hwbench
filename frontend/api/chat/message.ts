import Anthropic from '@anthropic-ai/sdk';
import type { IncomingMessage, ServerResponse } from 'http';

interface ChatMessage { role: 'user' | 'assistant'; content: string; }

interface InstrumentContext {
  oscilloscope?: {
    ch1?: { frequency: string; vpp: string; vmin: string; vmax: string; coupling: string; probe: string; voltPerDiv: string };
    ch2?: { frequency: string; vpp: string; vmin: string; vmax: string; coupling: string; probe: string; voltPerDiv: string };
  };
  trigger?: { source: string; edge: string; level: string; mode: string };
  acquisition?: { mode: string; averages: number | null };
  protocol_traffic?: string[];
  function_generator?: { waveform: string; frequency: string; amplitude: string; w1: boolean; w2: boolean };
  multimeter?: { mode: string; reading: string };
  code_context?: string | null;
  demo_scenario?: string;
  mode?: 'mock' | 'live';
}

function buildSystemPrompt(ctx: InstrumentContext): string {
  const ch1 = ctx.oscilloscope?.ch1;
  const ch2 = ctx.oscilloscope?.ch2;
  const trig = ctx.trigger;
  const acq = ctx.acquisition;
  const fg = ctx.function_generator;
  const mm = ctx.multimeter;
  const isMock = ctx.mode === 'mock';

  let prompt = `You are HWBench's embedded hardware debugging assistant for robotics engineers. Analyze oscilloscope data, protocol packets, function generator settings, multimeter readings, trigger config, acquisition settings, and code context.${isMock ? ' [NOTE: MOCK mode — simulated data, no physical hardware connected]' : ''}

LIVE INSTRUMENT READINGS:

OSCILLOSCOPE:
  CH1 (cyan)  : ${ch1 ? `${ch1.frequency} | ${ch1.vpp}pp | range [${ch1.vmin}, ${ch1.vmax}] | coupling=${ch1.coupling} | probe=${ch1.probe} | ${ch1.voltPerDiv}/div` : 'no signal'}
  CH2 (amber) : ${ch2 ? `${ch2.frequency} | ${ch2.vpp}pp | range [${ch2.vmin}, ${ch2.vmax}] | coupling=${ch2.coupling} | probe=${ch2.probe} | ${ch2.voltPerDiv}/div` : 'no signal'}

TRIGGER: source=${trig?.source ?? 'CH1'} edge=${trig?.edge ?? 'rising'} level=${trig?.level ?? '0.00V'} mode=${trig?.mode ?? 'AUTO'}

ACQUISITION: mode=${acq?.mode ?? 'NORM'}${acq?.averages ? ` averages=${acq.averages}` : ''}

DEMO SCENARIO: ${ctx.demo_scenario ?? 'unspecified'}

`;

  if (fg) prompt += `FUNCTION GENERATOR: ${fg.waveform} ${fg.frequency} ${fg.amplitude} W1=${fg.w1 ? 'ON' : 'OFF'} W2=${fg.w2 ? 'ON' : 'OFF'}\n\n`;
  if (mm) prompt += `MULTIMETER: mode=${mm.mode} reading=${mm.reading}\n\n`;

  if (ctx.protocol_traffic && ctx.protocol_traffic.length > 0) {
    prompt += `RECENT PROTOCOL TRAFFIC (last ${ctx.protocol_traffic.length} packets):\n`;
    ctx.protocol_traffic.forEach(line => { prompt += `  ${line}\n`; });
    prompt += '\n';
  }

  if (ctx.code_context) prompt += `CODE CONTEXT:\n${ctx.code_context}\n\n`;

  prompt += `Do not invent a fault. Answer like a hardware debug note, not a chatbot.

Use exactly this compact Markdown structure:

### Finding
<one sentence: likely issue or "No clear fault detected.">

### Why I think this
- <2-3 bullets using actual evidence from the bench>

### Where to look
- <1-3 specific signals, wires, files, registers, or settings>

### Next check / fix
- <1-3 concrete actions>

Keep the full answer under 120 words unless asked for detail.`;

  return prompt;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  let messages: ChatMessage[];
  let context: InstrumentContext;
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw) as { messages: ChatMessage[]; context: InstrumentContext };
    messages = body.messages;
    context = body.context ?? {};
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  if (!messages || messages.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Messages required' }));
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'API key not configured' }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  try {
    const client = new Anthropic({ apiKey });
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      system: buildSystemPrompt(context),
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    res.end();
  }
}
