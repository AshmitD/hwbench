export interface SchematicEntry {
  ref: string;
  value: string;
  pin: string;
}

export interface ParsedNet {
  netName: string;
  entries: SchematicEntry[];
}

export interface ParsedSchematic {
  fileName: string;
  nets: ParsedNet[];
  componentCount: number;
}

// ─── Tokeniser ────────────────────────────────────────────────────────────────
function tokenise(src: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < src.length) {
    if (src[i] === ';') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (/\s/.test(src[i])) { i++; continue; }
    if (src[i] === '(' || src[i] === ')') { tokens.push(src[i++]); continue; }
    if (src[i] === '"') {
      let s = '"'; i++;
      while (i < src.length && src[i] !== '"') { if (src[i] === '\\') i++; s += src[i++]; }
      s += '"'; i++;
      tokens.push(s);
      continue;
    }
    let atom = '';
    while (i < src.length && src[i] !== '(' && src[i] !== ')' && !/\s/.test(src[i])) atom += src[i++];
    if (atom) tokens.push(atom);
  }
  return tokens;
}

type SExpr = string | SExpr[];

function parse(tokens: string[], pos = { i: 0 }): SExpr {
  if (tokens[pos.i] === '(') {
    pos.i++;
    const list: SExpr[] = [];
    while (pos.i < tokens.length && tokens[pos.i] !== ')') list.push(parse(tokens, pos));
    pos.i++;
    return list;
  }
  const tok = tokens[pos.i++];
  return tok.startsWith('"') ? tok.slice(1, -1) : tok;
}

function unquote(s: string): string {
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

function isList(x: SExpr): x is SExpr[] { return Array.isArray(x); }
function head(x: SExpr): string { return isList(x) ? (typeof x[0] === 'string' ? x[0] : '') : x; }

function findAll(node: SExpr, tag: string): SExpr[][] {
  const results: SExpr[][] = [];
  if (!isList(node)) return results;
  if (head(node) === tag) results.push(node as SExpr[]);
  for (const child of node as SExpr[]) results.push(...findAll(child, tag));
  return results;
}

// ─── Main parser ──────────────────────────────────────────────────────────────
export function parseKicadSchematic(content: string, fileName: string): ParsedSchematic {
  const tokens = tokenise(content);
  if (!tokens.length) return { fileName, nets: [], componentCount: 0 };

  const pos = { i: 0 };
  let root: SExpr;
  try { root = parse(tokens, pos); }
  catch { return { fileName, nets: [], componentCount: 0 }; }

  if (!isList(root)) return { fileName, nets: [], componentCount: 0 };
  const rootArr = root as SExpr[];

  // ── 1. Parse lib_symbols to build pin-offset map ───────────────────────────
  // KiCad 6: placed symbols only carry (pin "N" (uuid ...)); actual pin geometry
  // is in lib_symbols. We must look up dx/dy offsets there.
  // Map: libId -> Map<pinNumber, {dx, dy}>
  const libPinMap = new Map<string, Map<string, { dx: number; dy: number }>>();

  const libSymsNode = rootArr.find(n => isList(n) && head(n) === 'lib_symbols') as SExpr[] | undefined;
  if (libSymsNode) {
    for (const entry of (libSymsNode as SExpr[]).slice(1)) {
      if (!isList(entry) || head(entry) !== 'symbol') continue;
      const entryArr = entry as SExpr[];
      const libId = typeof entryArr[1] === 'string' ? unquote(entryArr[1]) : '';
      if (!libId) continue;

      const pinMap = new Map<string, { dx: number; dy: number }>();
      // Pins live inside sub-symbols like (symbol "Lib:Part_1_1" ...)
      for (const pn of findAll(entry, 'pin')) {
        const pnArr = pn as SExpr[];
        // Lib pins: (pin type dir (at dx dy angle) (length l) ... (number "N" ...))
        // Placed pins: (pin "N" (uuid "...")) — type is a string literal, not a tag
        // Distinguish by checking that element [1] and [2] are bare strings (type/dir)
        if (typeof pnArr[1] !== 'string' || typeof pnArr[2] !== 'string') continue;
        let dx = 0, dy = 0, number = '';
        for (const pc of pnArr) {
          if (isList(pc) && head(pc) === 'at') {
            const at = pc as SExpr[];
            dx = parseFloat(typeof at[1] === 'string' ? at[1] : '0');
            dy = parseFloat(typeof at[2] === 'string' ? at[2] : '0');
          }
          if (isList(pc) && head(pc) === 'number') {
            number = typeof (pc as SExpr[])[1] === 'string' ? unquote((pc as SExpr[])[1] as string) : '';
          }
        }
        if (number && !pinMap.has(number)) pinMap.set(number, { dx, dy });
      }
      if (pinMap.size > 0) libPinMap.set(libId, pinMap);
    }
  }

  // ── 2. Parse placed symbol instances ──────────────────────────────────────
  // KiCad 6 placed symbol: (symbol (lib_id "Device:R") (at X Y angle) ...)
  // KiCad 6 lib symbol:    (symbol "Device:R" ...) — second element is a bare string
  interface SymbolInst {
    ref: string; value: string; libId: string;
    x: number; y: number; angle: number;
    pins: { number: string; x: number; y: number }[];
  }
  const symbols: SymbolInst[] = [];

  for (const node of rootArr) {
    if (!isList(node) || head(node) !== 'symbol') continue;
    const nodeArr = node as SExpr[];
    // Placed symbols have (lib_id "...") as their first child (a list)
    if (!isList(nodeArr[1]) || head(nodeArr[1]) !== 'lib_id') continue;

    const libId = typeof (nodeArr[1] as SExpr[])[1] === 'string'
      ? unquote((nodeArr[1] as SExpr[])[1] as string) : '';

    let ref = '', value = '', x = 0, y = 0, angle = 0;
    for (const child of nodeArr) {
      if (isList(child) && head(child) === 'at') {
        const at = child as SExpr[];
        x = parseFloat(typeof at[1] === 'string' ? at[1] : '0');
        y = parseFloat(typeof at[2] === 'string' ? at[2] : '0');
        angle = parseFloat(typeof at[3] === 'string' ? at[3] : '0');
      }
      if (isList(child) && head(child) === 'property') {
        const prop = child as SExpr[];
        const pName = typeof prop[1] === 'string' ? unquote(prop[1]) : '';
        const pVal  = typeof prop[2] === 'string' ? unquote(prop[2]) : '';
        if (pName === 'Reference') ref = pVal;
        if (pName === 'Value')     value = pVal;
      }
    }
    if (!ref || ref === '~') continue;

    // Transform pin offsets by placement rotation.
    // KiCad 6 uses Y-down coords; rotation angles are CCW on screen.
    // In Y-down CCW rotation by θ: x' = dx·cos(θ) + dy·sin(θ), y' = −dx·sin(θ) + dy·cos(θ)
    const θ = angle * Math.PI / 180;
    const c = Math.cos(θ), s = Math.sin(θ);
    const libPins = libPinMap.get(libId);
    const pins: { number: string; x: number; y: number }[] = [];
    if (libPins) {
      for (const [number, { dx, dy }] of libPins) {
        pins.push({ number, x: x + dx * c + dy * s, y: y - dx * s + dy * c });
      }
    } else {
      // No lib entry found — place a virtual pin at symbol center
      pins.push({ number: '?', x, y });
    }
    symbols.push({ ref, value, libId, x, y, angle, pins });
  }

  const componentCount = symbols.filter(s => !s.ref.startsWith('#')).length;

  // ── 3. Parse wire segments ─────────────────────────────────────────────────
  interface Seg { x1: number; y1: number; x2: number; y2: number }
  const wires: Seg[] = [];
  for (const node of rootArr) {
    if (!isList(node) || head(node) !== 'wire') continue;
    const ptsNode = (node as SExpr[]).find(n => isList(n) && head(n) === 'pts') as SExpr[] | undefined;
    if (!ptsNode) continue;
    const xys = (ptsNode as SExpr[]).filter(n => isList(n) && head(n) === 'xy') as SExpr[][];
    if (xys.length < 2) continue;
    wires.push({
      x1: parseFloat(typeof xys[0][1] === 'string' ? xys[0][1] : '0'),
      y1: parseFloat(typeof xys[0][2] === 'string' ? xys[0][2] : '0'),
      x2: parseFloat(typeof xys[1][1] === 'string' ? xys[1][1] : '0'),
      y2: parseFloat(typeof xys[1][2] === 'string' ? xys[1][2] : '0'),
    });
  }

  // ── 4. Parse net labels ────────────────────────────────────────────────────
  interface NetLabel { name: string; x: number; y: number }
  const labels: NetLabel[] = [];
  for (const tag of ['label', 'global_label', 'hierarchical_label', 'net_label']) {
    for (const node of rootArr) {
      if (!isList(node) || head(node) !== tag) continue;
      const nodeArr = node as SExpr[];
      const name = typeof nodeArr[1] === 'string' ? unquote(nodeArr[1]) : '';
      if (!name) continue;
      let lx = 0, ly = 0;
      for (const child of nodeArr) {
        if (isList(child) && head(child) === 'at') {
          lx = parseFloat(typeof (child as SExpr[])[1] === 'string' ? (child as SExpr[])[1] as string : '0');
          ly = parseFloat(typeof (child as SExpr[])[2] === 'string' ? (child as SExpr[])[2] as string : '0');
        }
      }
      labels.push({ name, x: lx, y: ly });
    }
  }
  // Power symbols as net labels (connect at their pin position)
  for (const sym of symbols) {
    if (sym.ref.startsWith('#PWR') || sym.ref.startsWith('#FLG')) {
      const pin = sym.pins[0];
      labels.push({ name: sym.value, x: pin ? pin.x : sym.x, y: pin ? pin.y : sym.y });
    }
  }

  // ── 5. Build wire adjacency graph + BFS ────────────────────────────────────
  // 2 decimal places = 0.01 mm precision; wire endpoints in KiCad are on a
  // 50-mil (1.27 mm) or 100-mil (2.54 mm) grid so this is more than adequate.
  const PREC = 2;
  const key = (x: number, y: number) => `${x.toFixed(PREC)},${y.toFixed(PREC)}`;
  const adj = new Map<string, Set<string>>();
  const ensure = (k: string) => { if (!adj.has(k)) adj.set(k, new Set()); };
  const addEdge = (x1: number, y1: number, x2: number, y2: number) => {
    const k1 = key(x1, y1), k2 = key(x2, y2);
    ensure(k1); ensure(k2);
    adj.get(k1)!.add(k2); adj.get(k2)!.add(k1);
  };
  for (const w of wires) addEdge(w.x1, w.y1, w.x2, w.y2);

  // Snap a position to the nearest graph node within 0.15 mm
  const SNAP = 0.15;
  const snapKey = (x: number, y: number): string | null => {
    const k = key(x, y);
    if (adj.has(k)) return k;
    let best: string | null = null, bestD = SNAP;
    for (const nk of adj.keys()) {
      const [nx, ny] = nk.split(',').map(Number);
      const d = Math.hypot(nx - x, ny - y);
      if (d < bestD) { bestD = d; best = nk; }
    }
    return best;
  };

  const bfs = (startKey: string): Set<string> => {
    const visited = new Set<string>([startKey]);
    const queue = [startKey];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const nb of adj.get(cur) ?? []) {
        if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
      }
    }
    return visited;
  };

  // ── 6. Match labels → pins via wire graph ─────────────────────────────────
  const netMap = new Map<string, SchematicEntry[]>();

  for (const label of labels) {
    const startKey = snapKey(label.x, label.y);
    const connected: Set<string> = startKey ? bfs(startKey) : new Set();

    for (const sym of symbols) {
      if (sym.ref.startsWith('#')) continue;
      for (const pin of sym.pins) {
        const pk = snapKey(pin.x, pin.y);
        if (!pk || !connected.has(pk)) continue;
        if (!netMap.has(label.name)) netMap.set(label.name, []);
        netMap.get(label.name)!.push({ ref: sym.ref, value: sym.value, pin: pin.number });
      }
    }
  }

  // ── 7. Fallback: proximity match (catches direct label-to-pin with no wire) ─
  if (netMap.size === 0 && labels.length > 0) {
    const PROX = 5.08; // 200-mil; direct connections or close placements
    for (const label of labels) {
      for (const sym of symbols) {
        if (sym.ref.startsWith('#')) continue;
        for (const pin of sym.pins) {
          if (Math.hypot(pin.x - label.x, pin.y - label.y) <= PROX) {
            if (!netMap.has(label.name)) netMap.set(label.name, []);
            netMap.get(label.name)!.push({ ref: sym.ref, value: sym.value, pin: pin.number });
          }
        }
      }
    }
  }

  // ── 8. Build sorted output ────────────────────────────────────────────────
  const nets: ParsedNet[] = [];
  for (const [netName, entries] of netMap.entries()) {
    const seen = new Set<string>();
    const unique = entries.filter(e => {
      const k = `${e.ref}.${e.pin}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    nets.push({ netName, entries: unique });
  }

  nets.sort((a, b) => {
    const aPwr = /^(VCC|VDD|GND|AGND|DGND|\+\d|PWR)/i.test(a.netName);
    const bPwr = /^(VCC|VDD|GND|AGND|DGND|\+\d|PWR)/i.test(b.netName);
    if (aPwr !== bPwr) return aPwr ? 1 : -1;
    return a.netName.localeCompare(b.netName);
  });

  return { fileName, nets, componentCount };
}

// ─── Format netlist for Claude prompt ─────────────────────────────────────────
export function formatNetlistForPrompt(schematic: ParsedSchematic): string {
  const { fileName, nets, componentCount } = schematic;
  if (!nets.length) return `${fileName}: no nets parsed`;

  const lines: string[] = [
    `${fileName} (${nets.length} nets, ${componentCount} components):`,
  ];
  for (const net of nets.slice(0, 40)) {
    const parts = net.entries.map(e => `${e.ref}(${e.value}).pin${e.pin}`).join(', ');
    lines.push(`  ${net.netName}: ${parts || '—'}`);
  }
  if (nets.length > 40) lines.push(`  ... (${nets.length - 40} more nets)`);
  return lines.join('\n');
}
