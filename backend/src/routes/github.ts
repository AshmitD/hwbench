import express from 'express';

const router = express.Router();

interface TreeNode {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
}

function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  try {
    const clean = url.replace(/\.git$/, '').replace(/\/$/, '');
    const match = clean.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
  } catch {
    return null;
  }
}

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.cpp', '.cc', '.cxx', '.c',
  '.h', '.hpp', '.java', '.go', '.rs', '.cs', '.swift', '.lua',
  '.yaml', '.yml', '.json', '.xml', '.urdf', '.md', '.txt', '.sh',
]);

function isCodeFile(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return false;
  return CODE_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

router.get('/tree', async (req, res) => {
  try {
    const { url } = req.query as { url?: string };
    if (!url) return res.status(400).json({ error: 'url query param required' });

    const parsed = parseGithubUrl(url);
    if (!parsed) return res.status(400).json({ error: 'Invalid GitHub URL' });

    const { owner, repo } = parsed;

    // Get default branch
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'CoupledAI-HWDebug' },
    });

    if (!repoRes.ok) {
      if (repoRes.status === 404) return res.status(404).json({ error: 'Repository not found' });
      if (repoRes.status === 403) return res.status(429).json({ error: 'GitHub rate limit exceeded' });
      throw new Error(`GitHub API error: ${repoRes.status}`);
    }

    const repoData = (await repoRes.json()) as { default_branch: string };
    const branch = repoData.default_branch;

    // Get full tree
    const treeRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      { headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'CoupledAI-HWDebug' } },
    );

    if (!treeRes.ok) throw new Error(`Tree fetch failed: ${treeRes.status}`);

    const treeData = (await treeRes.json()) as { tree: TreeNode[]; truncated: boolean };

    const filtered = treeData.tree
      .filter((node) => node.type === 'tree' || isCodeFile(node.path))
      .filter((node) => !node.path.includes('node_modules') && !node.path.includes('.git'))
      .slice(0, 2000);

    return res.json({
      success: true,
      owner,
      repo,
      branch,
      truncated: treeData.truncated,
      tree: filtered,
    });
  } catch (error) {
    console.error('GitHub tree error:', error);
    return res.status(500).json({ error: 'Failed to fetch repository', message: error instanceof Error ? error.message : 'Unknown' });
  }
});

router.get('/file', async (req, res) => {
  try {
    const { url, path: filePath } = req.query as { url?: string; path?: string };
    if (!url || !filePath) return res.status(400).json({ error: 'url and path required' });

    const parsed = parseGithubUrl(url);
    if (!parsed) return res.status(400).json({ error: 'Invalid GitHub URL' });

    const { owner, repo } = parsed;
    const contentsRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
      { headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'CoupledAI-HWDebug' } },
    );

    if (!contentsRes.ok) {
      if (contentsRes.status === 404) return res.status(404).json({ error: 'File not found' });
      throw new Error(`Contents fetch failed: ${contentsRes.status}`);
    }

    const fileData = (await contentsRes.json()) as { content: string; encoding: string; size: number };

    if (fileData.size > 500 * 1024) {
      return res.status(413).json({ error: 'File too large (>500KB)' });
    }

    const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
    return res.json({ success: true, path: filePath, content });
  } catch (error) {
    console.error('GitHub file error:', error);
    return res.status(500).json({ error: 'Failed to fetch file', message: error instanceof Error ? error.message : 'Unknown' });
  }
});

export default router;
