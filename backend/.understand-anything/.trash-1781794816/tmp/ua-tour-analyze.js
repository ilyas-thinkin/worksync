#!/usr/bin/env node
'use strict';

function fail(msg) {
  process.stderr.write('ERROR: ' + msg + '\n');
  process.exit(1);
}

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  fail('Usage: node ua-tour-analyze.js <input.json> <output.json>');
}

let data;
try {
  const raw = require('fs').readFileSync(inputPath, 'utf8');
  data = JSON.parse(raw);
} catch (e) {
  fail('Failed to read/parse input file: ' + e.message);
}

const nodes = Array.isArray(data.nodes) ? data.nodes : [];
const edges = Array.isArray(data.edges) ? data.edges : [];
const layers = Array.isArray(data.layers) ? data.layers : [];

if (nodes.length === 0) fail('No nodes found in input');

try {
  const nodeById = new Map();
  for (const n of nodes) nodeById.set(n.id, n);

  // A & B: Fan-in / Fan-out
  const fanIn = new Map();
  const fanOut = new Map();
  for (const n of nodes) {
    fanIn.set(n.id, 0);
    fanOut.set(n.id, 0);
  }
  for (const e of edges) {
    if (fanOut.has(e.source)) fanOut.set(e.source, fanOut.get(e.source) + 1);
    if (fanIn.has(e.target)) fanIn.set(e.target, fanIn.get(e.target) + 1);
  }

  const fanInRanking = nodes
    .map(n => ({ id: n.id, fanIn: fanIn.get(n.id) || 0, name: n.name }))
    .sort((a, b) => b.fanIn - a.fanIn)
    .slice(0, 20);

  const fanOutRanking = nodes
    .map(n => ({ id: n.id, fanOut: fanOut.get(n.id) || 0, name: n.name }))
    .sort((a, b) => b.fanOut - a.fanOut)
    .slice(0, 20);

  // Thresholds for entry point scoring
  const fanOutValues = nodes.map(n => fanOut.get(n.id) || 0).sort((a, b) => a - b);
  const fanInValues = nodes.map(n => fanIn.get(n.id) || 0).sort((a, b) => a - b);
  function percentile(sortedArr, p) {
    if (sortedArr.length === 0) return 0;
    const idx = Math.floor(p * (sortedArr.length - 1));
    return sortedArr[idx];
  }
  const fanOutTop10ThresholdIdx = Math.floor(0.9 * (fanOutValues.length - 1));
  const fanOutTop10Threshold = fanOutValues[fanOutTop10ThresholdIdx];
  const fanInBottom25Threshold = percentile(fanInValues, 0.25);

  const entryFilenames = new Set([
    'index.ts', 'index.js', 'main.ts', 'main.js', 'app.ts', 'app.js',
    'server.ts', 'server.js', 'mod.rs', 'main.go', 'main.py', 'main.rs',
    'manage.py', 'app.py', 'wsgi.py', 'asgi.py', 'run.py', '__main__.py',
    'Application.java', 'Main.java', 'Program.cs', 'config.ru', 'index.php',
    'App.swift', 'Application.kt', 'main.cpp', 'main.c'
  ]);

  function pathDepth(filePath) {
    if (!filePath) return Infinity;
    const parts = filePath.split('/').filter(Boolean);
    return parts.length;
  }

  const entryScores = [];
  for (const n of nodes) {
    let score = 0;
    const isDoc = n.type === 'document';
    if (isDoc) {
      const isRoot = n.filePath && !n.filePath.includes('/');
      if (isRoot && /^readme\.md$/i.test(n.name || '')) {
        score += 5;
      } else if (isRoot && /\.md$/i.test(n.name || '')) {
        score += 2;
      }
    } else if (n.type === 'file') {
      if (entryFilenames.has(n.name)) score += 3;
      const depth = pathDepth(n.filePath);
      if (depth <= 2) score += 1;
      const fo = fanOut.get(n.id) || 0;
      if (fo >= fanOutTop10Threshold && fo > 0) score += 1;
      const fi = fanIn.get(n.id) || 0;
      if (fi <= fanInBottom25Threshold) score += 1;
    }
    if (score > 0) {
      entryScores.push({ id: n.id, score, name: n.name, summary: n.summary });
    }
  }
  entryScores.sort((a, b) => b.score - a.score);
  const entryPointCandidates = entryScores.slice(0, 5);

  // D: BFS from top code entry point (skip documentation)
  const codeEntryCandidates = entryScores.filter(c => {
    const node = nodeById.get(c.id);
    return node && node.type !== 'document';
  });
  const startNode = codeEntryCandidates.length > 0 ? codeEntryCandidates[0].id : (nodes[0] ? nodes[0].id : null);

  const adjacency = new Map();
  for (const n of nodes) adjacency.set(n.id, []);
  for (const e of edges) {
    if ((e.type === 'imports' || e.type === 'calls') && adjacency.has(e.source)) {
      adjacency.get(e.source).push(e.target);
    }
  }

  const bfsOrder = [];
  const depthMap = {};
  const byDepth = {};
  if (startNode) {
    const visited = new Set([startNode]);
    const queue = [[startNode, 0]];
    while (queue.length > 0) {
      const [cur, depth] = queue.shift();
      bfsOrder.push(cur);
      depthMap[cur] = depth;
      if (!byDepth[depth]) byDepth[depth] = [];
      byDepth[depth].push(cur);
      const neighbors = adjacency.get(cur) || [];
      for (const next of neighbors) {
        if (!visited.has(next) && nodeById.has(next)) {
          visited.add(next);
          queue.push([next, depth + 1]);
        }
      }
    }
  }

  // E: Non-code file inventory
  const nonCodeFiles = {
    documentation: [],
    infrastructure: [],
    data: [],
    config: []
  };
  for (const n of nodes) {
    const entry = { id: n.id, name: n.name, type: n.type, summary: n.summary };
    if (n.type === 'document') nonCodeFiles.documentation.push(entry);
    else if (n.type === 'service' || n.type === 'pipeline' || n.type === 'resource') nonCodeFiles.infrastructure.push(entry);
    else if (n.type === 'table' || n.type === 'schema' || n.type === 'endpoint') nonCodeFiles.data.push(entry);
    else if (n.type === 'config') nonCodeFiles.config.push(entry);
  }

  // F: Tightly coupled clusters
  const edgeKey = (a, b) => a + '||' + b;
  const edgeSet = new Set();
  for (const e of edges) {
    if (e.type === 'imports' || e.type === 'calls') {
      edgeSet.add(edgeKey(e.source, e.target));
    }
  }
  const bidirectionalPairs = [];
  const seenPairs = new Set();
  for (const e of edges) {
    if (e.type !== 'imports' && e.type !== 'calls') continue;
    const a = e.source, b = e.target;
    if (a === b) continue;
    const pairKey = [a, b].sort().join('||');
    if (seenPairs.has(pairKey)) continue;
    if (edgeSet.has(edgeKey(a, b)) && edgeSet.has(edgeKey(b, a))) {
      bidirectionalPairs.push([a, b]);
      seenPairs.add(pairKey);
    }
  }

  // Build undirected adjacency for cluster expansion
  const undirectedAdj = new Map();
  for (const n of nodes) undirectedAdj.set(n.id, new Set());
  for (const e of edges) {
    if (undirectedAdj.has(e.source) && undirectedAdj.has(e.target)) {
      undirectedAdj.get(e.source).add(e.target);
      undirectedAdj.get(e.target).add(e.source);
    }
  }

  const clusters = [];
  const usedInCluster = new Set();
  for (const [a, b] of bidirectionalPairs) {
    if (usedInCluster.has(a) || usedInCluster.has(b)) continue;
    const clusterSet = new Set([a, b]);
    // Expand: add nodes connecting to 2+ existing cluster members, up to size 5
    let expanded = true;
    while (expanded && clusterSet.size < 5) {
      expanded = false;
      const candidateCounts = new Map();
      for (const member of clusterSet) {
        const neighbors = undirectedAdj.get(member) || new Set();
        for (const neighbor of neighbors) {
          if (clusterSet.has(neighbor)) continue;
          candidateCounts.set(neighbor, (candidateCounts.get(neighbor) || 0) + 1);
        }
      }
      let bestCandidate = null;
      let bestCount = 1;
      for (const [cand, count] of candidateCounts) {
        if (count >= 2 && count > bestCount) {
          bestCandidate = cand;
          bestCount = count;
        }
      }
      if (bestCandidate) {
        clusterSet.add(bestCandidate);
        expanded = true;
      }
    }
    let edgeCount = 0;
    const clusterArr = [...clusterSet];
    for (const e of edges) {
      if (clusterSet.has(e.source) && clusterSet.has(e.target) && e.source !== e.target) {
        edgeCount++;
      }
    }
    if (clusterArr.length >= 2) {
      clusters.push({ nodes: clusterArr, edgeCount });
      for (const m of clusterArr) usedInCluster.add(m);
    }
  }
  clusters.sort((x, y) => y.edgeCount - x.edgeCount);
  const topClusters = clusters.slice(0, 10);

  // G: Layer list
  const layerList = layers.map(l => ({ id: l.id, name: l.name, description: l.description }));

  // H: Node summary index
  const nodeSummaryIndex = {};
  for (const n of nodes) {
    nodeSummaryIndex[n.id] = { name: n.name, type: n.type, summary: n.summary };
  }

  const result = {
    scriptCompleted: true,
    entryPointCandidates,
    fanInRanking,
    fanOutRanking,
    bfsTraversal: {
      startNode,
      order: bfsOrder,
      depthMap,
      byDepth
    },
    nonCodeFiles,
    clusters: topClusters,
    layers: {
      count: layerList.length,
      list: layerList
    },
    nodeSummaryIndex,
    totalNodes: nodes.length,
    totalEdges: edges.length
  };

  require('fs').writeFileSync(outputPath, JSON.stringify(result, null, 2));
  process.exit(0);
} catch (e) {
  fail('Unexpected error: ' + (e && e.stack ? e.stack : String(e)));
}
