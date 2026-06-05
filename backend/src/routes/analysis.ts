import express from 'express';
import fs from 'fs/promises';
import path from 'path';

interface RobotStructureInput {
  name: string;
  links: Array<{ name: string }>;
  joints: Array<{ name: string; type: string }>;
}

interface MatchResult {
  name: string;
  kind: 'link' | 'joint';
  count: number;
  confidence: number;
}

const router = express.Router();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeToken(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function countNameMentions(content: string, name: string): number {
  if (!name.trim()) {
    return 0;
  }

  const exactPattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'gi');
  const exactMatches = content.match(exactPattern)?.length ?? 0;

  const normalizedName = normalizeToken(name);
  if (!normalizedName) {
    return exactMatches;
  }

  const normalizedContent = content.toLowerCase().replace(/[^a-z0-9]/g, ' ');
  const normalizedPattern = new RegExp(`\\b${escapeRegExp(normalizedName)}\\b`, 'g');
  const normalizedMatches = normalizedContent.match(normalizedPattern)?.length ?? 0;

  return Math.max(exactMatches, normalizedMatches);
}

function scoreConfidence(mentions: number): number {
  if (mentions <= 0) {
    return 0;
  }
  if (mentions === 1) {
    return 0.45;
  }
  if (mentions === 2) {
    return 0.7;
  }
  if (mentions === 3) {
    return 0.85;
  }
  return 0.95;
}

router.post('/code', async (req, res) => {
  try {
    const { filename, robotStructure } = req.body as {
      filename?: string;
      robotStructure?: RobotStructureInput;
    };

    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    if (!robotStructure) {
      return res.status(400).json({ error: 'robotStructure is required for coupling analysis' });
    }

    const ext = path.extname(filename).toLowerCase();
    if (ext === '.zip') {
      return res.status(400).json({
        error: 'Zip analysis not implemented yet',
        message: 'Upload a representative source file (e.g. .py, .cpp, .ts) for v1 matching.',
      });
    }

    const filePath = path.join(process.cwd(), 'uploads', filename);
    const code = await fs.readFile(filePath, 'utf-8');

    const matches: MatchResult[] = [];

    for (const link of robotStructure.links ?? []) {
      const mentions = countNameMentions(code, link.name);
      if (mentions > 0) {
        matches.push({
          name: link.name,
          kind: 'link',
          count: mentions,
          confidence: scoreConfidence(mentions),
        });
      }
    }

    for (const joint of robotStructure.joints ?? []) {
      const mentions = countNameMentions(code, joint.name);
      if (mentions > 0) {
        matches.push({
          name: joint.name,
          kind: 'joint',
          count: mentions,
          confidence: scoreConfidence(mentions),
        });
      }
    }

    matches.sort((a, b) => {
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence;
      }
      return b.count - a.count;
    });

    const summary = {
      totalMatches: matches.length,
      highConfidence: matches.filter((m) => m.confidence >= 0.8).length,
      mediumConfidence: matches.filter((m) => m.confidence >= 0.6 && m.confidence < 0.8).length,
      lowConfidence: matches.filter((m) => m.confidence < 0.6).length,
    };

    return res.json({
      success: true,
      data: {
        summary,
        matches,
      },
    });
  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({
      error: 'Failed to analyze code',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
