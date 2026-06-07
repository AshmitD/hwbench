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

// ─── Tokeniser for S-expression ───────────────────────────────────────────────
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
    while (tokens[pos.i] !== ')') list.push(parse(tokens, pos));
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isList(x: SExpr): x is SExpr[] { return Array.isArray(x); }
function head(x: SExpr): string { return isList(x) ? (typeof x[0] === 'string' ? x[0] : '') : x; }

function findAll(node: SExpr, tag: string): SExpr[][] {
  const results: SExpr[][] = [];
  if (!isList(node)) return results;
  if (head(node) === tag) results.push(node as SExpr[]);
  for (const child of node as SExpr[]) results.push(...findAll(child, tag));
  return results;
}

function getAttr(node: SExpr[], key: string): string | null {
  for (const child of node) {
    if (isList(child) && head(child) === key && typeof (child as SExpr[])[1] === 'string') {
      return unquote((child as SExpr[])[1] as string);
    }
  }
  return null;
}

// ─── Main parser ──────────────────────────────────────────────────────────────
export function parseKicadSchematic(content: string, fileName: string): ParsedSchematic {
  const tokens = tokenise(content);
  if (!tokens.length) return { fileName, nets: [], componentCount: 0 };

  const pos = { i: 0 };
  let root: SExpr;
  try {
    root = parse(tokens, pos);
  } catch {
    return { fileName, nets: [], componentCount: 0 };
  }

  if (!isList(root)) return { fileName, nets: [], componentCount: 0 };

  // ── Collect symbol instances (placed components) ───────────────────────────
  interface SymbolInst {
    ref: string;
    value: string;
    x: number;
    y: number;
    pins: { number: string; x: number; y: number }[];
  }

  const symbols: SymbolInst[] = [];
  const symNodes = findAll(root, 'symbol');

  for (const sym of symNodes) {
    // Skip library symbol definitions (nested inside lib_symbols)
    const isLibDef = symNodes.some(parent =>
      parent !== sym && isList(parent) && (parent as SExpr[]).includes(sym as SExpr)
    );
    if (isLibDef) continue;

    // Get reference and value from properties
    let ref = '';
    let value = '';
    let x = 0, y = 0;

    // position: (at X Y angle)
    for (const child of sym) {
      if (isList(child) && head(child) === 'at') {
        const at = child as SExpr[];
        x = parseFloat(typeof at[1] === 'string' ? at[1] : '0');
        y = parseFloat(typeof at[2] === 'string' ? at[2] : '0');
      }
      if (isList(child) && head(child) === 'property') {
        const prop = child as SExpr[];
        const propName = typeof prop[1] === 'string' ? unquote(prop[1]) : '';
        const propVal  = typeof prop[2] === 'string' ? unquote(prop[2]) : '';
        if (propName === 'Reference') ref = propVal;
        if (propName === 'Value')     value = propVal;
      }
    }

    // Collect pin nodes
    const pinNodes = findAll(sym as SExpr, 'pin');
    const pins: { number: string; x: number; y: number }[] = [];
    for (const pn of pinNodes) {
      // pin has (at X Y) child and a number attribute
      let px = 0, py = 0;
      let number = '';
      for (const pc of pn) {
        if (isList(pc) && head(pc) === 'at') {
          const pat = pc as SExpr[];
          px = parseFloat(typeof pat[1] === 'string' ? pat[1] : '0');
          py = parseFloat(typeof pat[2] === 'string' ? pat[2] : '0');
        }
        if (isList(pc) && head(pc) === 'number') {
          number = typeof (pc as SExpr[])[1] === 'string' ? unquote((pc as SExpr[])[1] as string) : '';
        }
      }
      if (number) pins.push({ number, x: x + px, y: y + py });
    }

    if (ref && ref !== '~' && !ref.startsWith('#')) {
      symbols.push({ ref, value, x, y, pins });
    }
  }

  // ── Collect net labels ─────────────────────────────────────────────────────
  interface NetLabel { name: string; x: number; y: number }
  const labels: NetLabel[] = [];

  for (const tag of ['net_label', 'label', 'global_label', 'hierarchical_label']) {
    for (const lbl of findAll(root, tag)) {
      const lblArr = lbl as SExpr[];
      const name = typeof lblArr[1] === 'string' ? unquote(lblArr[1]) : getAttr(lblArr, 'name') ?? '';
      let lx = 0, ly = 0;
      for (const child of lblArr) {
        if (isList(child) && head(child) === 'at') {
          const at = child as SExpr[];
          lx = parseFloat(typeof at[1] === 'string' ? at[1] : '0');
          ly = parseFloat(typeof at[2] === 'string' ? at[2] : '0');
        }
      }
      if (name) labels.push({ name, x: lx, y: ly });
    }
  }

  // ── Also collect power symbols as net labels ───────────────────────────────
  for (const sym of symbols) {
    if (sym.ref.startsWith('#PWR') || sym.ref.startsWith('#FLG')) {
      labels.push({ name: sym.value, x: sym.x, y: sym.y });
    }
  }

  // ── Match labels to symbol pins by proximity ───────────────────────────────
  const SNAP = 2.54 * 3; // 3 grid units tolerance

  const netMap = new Map<string, SchematicEntry[]>();

  for (const sym of symbols) {
    if (sym.ref.startsWith('#')) continue;
    for (const pin of sym.pins) {
      // Find nearest label
      let nearest: NetLabel | null = null;
      let minDist = SNAP;
      for (const lbl of labels) {
        const d = Math.hypot(lbl.x - pin.x, lbl.y - pin.y);
        if (d < minDist) { minDist = d; nearest = lbl; }
      }
      if (nearest) {
        const net = nearest.name;
        if (!netMap.has(net)) netMap.set(net, []);
        netMap.get(net)!.push({ ref: sym.ref, value: sym.value, pin: pin.number });
      }
    }
  }

  // ── Also pull nets from wire+junction topology via net_label at wire ends ───
  // (covered above via label proximity)

  // ── Build sorted output ────────────────────────────────────────────────────
  const nets: ParsedNet[] = [];
  for (const [netName, entries] of netMap.entries()) {
    // Deduplicate entries
    const seen = new Set<string>();
    const unique = entries.filter(e => {
      const key = `${e.ref}.${e.pin}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    nets.push({ netName, entries: unique });
  }

  // Sort: power nets last, signal nets first
  nets.sort((a, b) => {
    const aPwr = /^(VCC|VDD|GND|AGND|DGND|\+\d|PWR)/i.test(a.netName);
    const bPwr = /^(VCC|VDD|GND|AGND|DGND|\+\d|PWR)/i.test(b.netName);
    if (aPwr !== bPwr) return aPwr ? 1 : -1;
    return a.netName.localeCompare(b.netName);
  });

  const componentCount = symbols.filter(s => !s.ref.startsWith('#')).length;
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
