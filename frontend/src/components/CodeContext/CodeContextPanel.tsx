import { useState, KeyboardEvent } from 'react';
import { useAppStore, TreeNode } from '../../store/appStore';
import styles from './CodeContextPanel.module.css';

function buildFolderMap(tree: TreeNode[]): Map<string, TreeNode[]> {
  const map = new Map<string, TreeNode[]>();
  map.set('', []);
  for (const node of tree) {
    const parts = node.path.split('/');
    const parentPath = parts.slice(0, -1).join('/');
    if (!map.has(parentPath)) map.set(parentPath, []);
    map.get(parentPath)!.push(node);
  }
  return map;
}

function FileTree({
  folderMap,
  prefix,
  depth,
  selectedPath,
  onFileClick,
}: {
  folderMap: Map<string, TreeNode[]>;
  prefix: string;
  depth: number;
  selectedPath: string | null;
  onFileClick: (path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const nodes = folderMap.get(prefix) ?? [];

  return (
    <>
      {nodes.map((node) => {
        const isDir = node.type === 'tree';
        const name = node.path.split('/').pop() ?? node.path;
        const indent = depth * 10;
        const isCollapsed = collapsed.has(node.path);

        if (isDir) {
          return (
            <div key={node.path}>
              <div
                className={`${styles.treeNode} ${styles.dir}`}
                style={{ paddingLeft: 8 + indent }}
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    next.has(node.path) ? next.delete(node.path) : next.add(node.path);
                    return next;
                  })
                }
              >
                <span className={styles.treeIcon}>{isCollapsed ? '▶' : '▼'}</span>
                <span className={styles.treeName}>{name}/</span>
              </div>
              {!isCollapsed && (
                <FileTree
                  folderMap={folderMap}
                  prefix={node.path}
                  depth={depth + 1}
                  selectedPath={selectedPath}
                  onFileClick={onFileClick}
                />
              )}
            </div>
          );
        }

        const isSelected = selectedPath === node.path;
        return (
          <div
            key={node.path}
            className={`${styles.treeNode} ${isSelected ? styles.selected : ''}`}
            style={{ paddingLeft: 8 + indent }}
            onClick={() => onFileClick(node.path)}
          >
            <span className={styles.treeIcon}>·</span>
            <span className={styles.treeName}>{name}</span>
          </div>
        );
      })}
    </>
  );
}

export default function CodeContextPanel() {
  const [inputUrl, setInputUrl] = useState('');
  const repoUrl = useAppStore((s) => s.repoUrl);
  const repoOwner = useAppStore((s) => s.repoOwner);
  const repoName = useAppStore((s) => s.repoName);
  const repoTree = useAppStore((s) => s.repoTree);
  const selectedFile = useAppStore((s) => s.selectedFile);
  const repoLoading = useAppStore((s) => s.repoLoading);
  const repoError = useAppStore((s) => s.repoError);

  const setRepo = useAppStore((s) => s.setRepo);
  const setRepoTree = useAppStore((s) => s.setRepoTree);
  const setSelectedFile = useAppStore((s) => s.setSelectedFile);
  const setRepoLoading = useAppStore((s) => s.setRepoLoading);
  const setRepoError = useAppStore((s) => s.setRepoError);
  const clearRepo = useAppStore((s) => s.clearRepo);

  const connect = async (url?: string) => {
    const target = (url ?? inputUrl).trim();
    if (!target) return;
    setRepoLoading(true);
    setRepoError(null);
    setRepoTree(null);
    setSelectedFile(null);

    try {
      const res = await fetch(`/api/github/tree?url=${encodeURIComponent(target)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setRepo(target, data.owner, data.repo);
      setRepoTree(data.tree);
    } catch (e: unknown) {
      setRepoError(e instanceof Error ? e.message : 'Failed to load repository');
    } finally {
      setRepoLoading(false);
    }
  };

  const loadFile = async (path: string) => {
    if (!repoUrl) return;
    try {
      const res = await fetch(`/api/github/file?url=${encodeURIComponent(repoUrl)}&path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setSelectedFile({ path, content: data.content });
    } catch (e: unknown) {
      setRepoError(e instanceof Error ? e.message : 'Failed to load file');
    }
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') connect();
  };

  const folderMap = repoTree ? buildFolderMap(repoTree) : null;
  const fileLines = selectedFile?.content.split('\n') ?? [];

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Code Context</span>
      </div>

      <div className={styles.urlSection}>
        <div className={styles.urlRow}>
          <input
            className={styles.urlInput}
            placeholder="github.com/owner/repo"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={handleKey}
            disabled={repoLoading}
          />
          <button className={styles.connectBtn} onClick={() => connect()} disabled={repoLoading || !inputUrl.trim()}>
            {repoLoading ? '…' : 'Load'}
          </button>
          {repoUrl && (
            <button
              className={styles.clearBtn}
              onClick={() => { clearRepo(); setInputUrl(''); }}
            >
              ✕
            </button>
          )}
        </div>
        {repoError && <div className={styles.error}>{repoError}</div>}
      </div>

      {repoOwner && (
        <div className={styles.repoInfo}>
          <span>repo:</span>
          <span className={styles.repoName}>{repoOwner}/{repoName}</span>
          <span style={{ marginLeft: 'auto' }}>{repoTree?.filter((n) => n.type === 'blob').length ?? 0} files</span>
        </div>
      )}

      <div className={styles.treeSection} style={{ flex: selectedFile ? '0 0 50%' : '1' }}>
        {repoLoading && (
          <div className={styles.loading}>
            <span className={styles.spinner} />
            Loading tree…
          </div>
        )}
        {!repoLoading && !repoTree && (
          <div className={styles.treeEmpty}>
            <p>No repository loaded.</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
              Enter a GitHub URL above to load a repo's file tree. The AI assistant will use the file you open as context.
            </p>
          </div>
        )}
        {folderMap && (
          <FileTree
            folderMap={folderMap}
            prefix=""
            depth={0}
            selectedPath={selectedFile?.path ?? null}
            onFileClick={loadFile}
          />
        )}
      </div>

      {selectedFile && (
        <div className={styles.fileSection}>
          <div className={styles.fileHeader}>
            <span className={styles.filePath}>{selectedFile.path}</span>
          </div>
          <div className={styles.fileContent}>
            <div className={styles.fileCode}>
              {fileLines.map((line, i) => (
                <div key={i} className={styles.codeLine}>
                  <span className={styles.lineNum}>{i + 1}</span>
                  <span>{line}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
