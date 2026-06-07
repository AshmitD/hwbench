import Anthropic from '@anthropic-ai/sdk';
import type { VercelRequest, VercelResponse } from '@vercel/node';

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

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

  let prompt = `You are HWBench's embedded hardware debugging assistant for robotics engineers. You analyze oscilloscope data, protocol packets, function generator settings, multimeter readings, trigger config, acquisition settings, code context, and optional user-described symptoms.${isMock ? ' [NOTE: Currently running in MOCK mode: simulated data, no physical hardware connected]' : ''}

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

  prompt += `Do not invent a fault. If evidence is weak, say so. Answer like a hardware debug note, not a chatbot. Use actual bench evidence.

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, context } = req.body as { messages: ChatMessage[]; context: InstrumentContext };

  if (!messages || messages.length === 0) {
    return res.status(400).json({ error: 'Messages required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const stream = getClient().messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      system: buildSystemPrompt(context || {}),
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Chat error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Chat failed', message: error instanceof Error ? error.message : 'Unknown' });
    } else {
      res.write(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`);
      res.end();
    }
  }
}
