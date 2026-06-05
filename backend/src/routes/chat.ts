import express from 'express';
import Anthropic from '@anthropic-ai/sdk';

const router = express.Router();

// Lazily instantiated so dotenv has time to load before first request
let _anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
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

You have access to:
- Live oscilloscope data from 2 channels including waveform statistics, coupling mode, and probe settings
- Trigger configuration and acquisition settings
- Decoded protocol traffic (I2C, SPI, UART) with full packet contents including addresses, register values, and decoded sensor data
- Function generator output settings
- Multimeter readings
- Optionally, the engineer's codebase for additional context

LIVE INSTRUMENT READINGS:

OSCILLOSCOPE:
  CH1 (cyan)  : ${ch1 ? `${ch1.frequency} | ${ch1.vpp}pp | range [${ch1.vmin}, ${ch1.vmax}] | coupling=${ch1.coupling} | probe=${ch1.probe} | ${ch1.voltPerDiv}/div` : 'no signal'}
  CH2 (amber) : ${ch2 ? `${ch2.frequency} | ${ch2.vpp}pp | range [${ch2.vmin}, ${ch2.vmax}] | coupling=${ch2.coupling} | probe=${ch2.probe} | ${ch2.voltPerDiv}/div` : 'no signal'}

TRIGGER: source=${trig?.source ?? 'CH1'} edge=${trig?.edge ?? 'rising'} level=${trig?.level ?? '0.00V'} mode=${trig?.mode ?? 'AUTO'}

ACQUISITION: mode=${acq?.mode ?? 'NORM'}${acq?.averages ? ` averages=${acq.averages}` : ''}

`;

  if (fg) {
    prompt += `FUNCTION GENERATOR: ${fg.waveform} ${fg.frequency} ${fg.amplitude} W1=${fg.w1 ? 'ON' : 'OFF'} W2=${fg.w2 ? 'ON' : 'OFF'}\n\n`;
  }

  if (mm) {
    prompt += `MULTIMETER: mode=${mm.mode} reading=${mm.reading}\n\n`;
  }

  if (ctx.protocol_traffic && ctx.protocol_traffic.length > 0) {
    prompt += `RECENT PROTOCOL TRAFFIC (last ${ctx.protocol_traffic.length} packets):\n`;
    ctx.protocol_traffic.forEach(line => { prompt += `  ${line}\n`; });
    prompt += '\n';
  }

  if (ctx.code_context) {
    prompt += `CODE CONTEXT:\n${ctx.code_context}\n\n`;
  }

  prompt += `Do not invent faults. If evidence is weak, say that clearly. Prioritize the most likely issue, confidence level, concrete evidence from current data, and one next measurement or action. Keep the answer concise and practical.

Use this output format unless the engineer asks for something else:
- Most likely issue:
- Confidence:
- Evidence:
- Suggested next check:

Keep each line short. If everything appears normal, say that under "Most likely issue" with low/medium confidence and give one useful next check. Ask for more context only when it is needed to choose the next measurement.`;

  return prompt;
}

router.post('/message', async (req, res) => {
  try {
    const { messages, context } = req.body as {
      messages: ChatMessage[];
      context: InstrumentContext;
    };

    if (!messages || messages.length === 0) {
      return res.status(400).json({ error: 'Messages required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const systemPrompt = buildSystemPrompt(context || {});

    const stream = getClient().messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
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
});

export default router;
