import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/src/mcp/server.js"],
  cwd: process.cwd(),
  stderr: "pipe",
});

const client = new Client({ name: "e2e-test", version: "1.0.0" });
const MCP_TIMEOUT_MS = Number(process.env.MCP_TIMEOUT_MS ?? 180000);

if (transport.stderr) {
  transport.stderr.on("data", d => process.stderr.write(`[cognex] ${d}`));
}
transport.onerror = (err) => {
  console.error("[transport:error]", err);
};
transport.onclose = () => {
  console.error("[transport:close]");
};

await client.connect(transport, { timeout: MCP_TIMEOUT_MS });

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

async function callTool(name, args) {
  const resp = await client.callTool(
    { name, arguments: args },
    undefined,
    { timeout: MCP_TIMEOUT_MS }
  );
  const text = resp?.content?.[0]?.text;
  if (!text) return { _raw: resp, _isError: resp?.isError };
  try { return { _parsed: JSON.parse(text), _text: text }; } catch { return { _text: text }; }
}

function extractId(result) {
  const match = result._text?.match(/ID:\s*([a-f0-9-]+)/);
  return match?.[1] ?? null;
}

// Wait for model to load
await new Promise(r => setTimeout(r, 4000));

// === Scenario 1: Store episodic memories (real-world user interactions) ===
console.log('\n=== Scenario 1: Store episodic memories ===');

const mem1 = await callTool('store_memory', {
  content: 'User prefers TypeScript over JavaScript for all backend projects'
});
const mem1Id = extractId(mem1);
check('store_memory (preference)', mem1Id != null, mem1._text);

const mem2 = await callTool('store_memory', {
  content: 'Debugging session: fixed a race condition in the websocket handler by adding a mutex lock'
});
const mem2Id = extractId(mem2);
check('store_memory (debugging)', mem2Id != null, mem2._text);

const mem3 = await callTool('store_memory', {
  content: 'The project uses vitest for testing, not jest. User got frustrated when I suggested jest.'
});
const mem3Id = extractId(mem3);
check('store_memory (correction)', mem3Id != null, mem3._text);

const mem4 = await callTool('store_memory', {
  content: 'Successfully deployed the API to production on AWS using CDK. User was thrilled with the zero-downtime deployment.'
});
const mem4Id = extractId(mem4);
check('store_memory (deployment)', mem4Id != null, mem4._text);

// === Scenario 2: Store semantic memory (abstracted insight) ===
console.log('\n=== Scenario 2: Add semantic memory ===');

const sem1 = await callTool('add_semantic_memory', {
  insight: 'User strongly prefers concise responses without unnecessary explanation. Direct code solutions are valued over verbose walkthroughs.',
  confidence: 0.9
});
const sem1Id = extractId(sem1);
check('add_semantic_memory', sem1Id != null, sem1._text);

// === Scenario 3: Query memories (hybrid search) ===
console.log('\n=== Scenario 3: Query memory (hybrid search) ===');

const q1 = await callTool('query_memory', { query: 'What testing framework does the user prefer?', limit: 5 });
const q1r = q1._parsed;  // returns array of MemorySearchResult directly
check('query_memory (testing) returns results', Array.isArray(q1r) && q1r.length > 0, `type: ${typeof q1r}`);
const foundVitest = q1r?.some(r => r.memory?.content?.includes('vitest'));
check('query found vitest reference', foundVitest, `top: ${q1r?.slice(0,2).map(r => r.memory?.content?.substring(0,60))}`);

const q2 = await callTool('query_memory', { query: 'deployment and AWS', limit: 5 });
const q2r = q2._parsed;
check('query_memory (deployment)', Array.isArray(q2r) && q2r.length > 0);
const foundAWS = q2r?.some(r => r.memory?.content?.includes('AWS'));
check('query found AWS reference', foundAWS);

const q3 = await callTool('query_memory', { query: 'user preferences for communication style', limit: 5 });
const q3r = q3._parsed;
check('query_memory (semantic)', Array.isArray(q3r) && q3r.length > 0);
const foundConcise = q3r?.some(r => r.memory?.content?.includes('concise'));
check('query found concise preference', foundConcise, `top: ${q3r?.slice(0,2).map(r => r.memory?.content?.substring(0,60))}`);

// === Scenario 4: Get memory stats ===
console.log('\n=== Scenario 4: Memory stats ===');

const stats = (await callTool('get_memory_stats', {}))._parsed;
check('stats: total_memories >= 5', stats?.total_memories >= 5, `total: ${stats?.total_memories}`);
check('stats: episodic_count >= 4', stats?.episodic_count >= 4, `episodic: ${stats?.episodic_count}`);
check('stats: semantic_count >= 1', stats?.semantic_count >= 1, `semantic: ${stats?.semantic_count}`);
check('stats: total_links present', stats?.total_links != null);

// === Scenario 5: Invalidate a memory ===
console.log('\n=== Scenario 5: Invalidate memory ===');

const inv = await callTool('invalidate_memory', { memory_id: mem1Id });
check('invalidate_memory succeeds', inv._text?.includes('successfully deleted'), inv._text);

// Verify gone from search
const q4 = await callTool('query_memory', { query: 'TypeScript over JavaScript preference', limit: 10 });
const q4r = q4._parsed;
const stillThere = q4r?.some(r => r.memory?.id === mem1Id);
check('invalidated memory not in results', !stillThere);

// Stats reflect deletion
const stats2 = (await callTool('get_memory_stats', {}))._parsed;
check('stats reflect deletion', stats2?.total_memories < stats?.total_memories, `before: ${stats.total_memories}, after: ${stats2?.total_memories}`);

// === Scenario 6: Create and update hypothesis ===
console.log('\n=== Scenario 6: Hypothesis lifecycle ===');

const hyp = await callTool('create_hypothesis', {
  hypothesis: 'Pull requests that include tests get merged faster',
  confidence: 0.5
});
const hypId = extractId(hyp);
check('create_hypothesis', hypId != null, hyp._text);

const upd = await callTool('update_hypothesis', {
  memory_id: hypId,
  confidence: 0.7,
  evidence_increment: 1,
  status: 'active'
});
check('update_hypothesis (success)', upd._text?.includes('Updated'), upd._text);

const upd2 = await callTool('update_hypothesis', {
  memory_id: hypId,
  confidence: 0.6,
  evidence_increment: 1,
});
check('update_hypothesis (more evidence)', upd2._text?.includes('Updated'), upd2._text);

// Hypothesis is queryable
const qH = await callTool('query_memory', { query: 'pull requests tests merged', limit: 5 });
const qHr = qH._parsed;
const foundHyp = qHr?.some(r => r.memory?.content?.includes('tests get merged'));
check('hypothesis is queryable', foundHyp);

// === Scenario 7: Tune retrieval params ===
console.log('\n=== Scenario 7: Tune retrieval params ===');

const tune = await callTool('tune_retrieval_params', {
  alpha: 0.7, beta: 0.05, spread_depth: 3
});
check('tune_retrieval_params', tune._text?.includes('Updated retrieval'), tune._text?.substring(0, 100));

// Query with tuned params
const q5 = await callTool('query_memory', { query: 'websocket debugging mutex race condition', limit: 5 });
const q5r = q5._parsed;
check('query after tuning works', Array.isArray(q5r) && q5r.length > 0);
const foundWs = q5r?.some(r => r.memory?.content?.includes('websocket'));
check('tuned query found websocket memory', foundWs, `top: ${q5r?.slice(0,2).map(r => r.memory?.content?.substring(0,60))}`);

// === Scenario 8: Edge cases + round-trip ===
console.log('\n=== Scenario 8: Edge cases + round-trip ===');

const empty = await callTool('query_memory', {
  query: 'quantum entanglement photon spectroscopy xylophone', limit: 3
});
check('query irrelevant topic returns without error', empty._parsed != null || empty._text != null);

const badInv = await callTool('invalidate_memory', { memory_id: 'nonexistent-uuid-123' });
check('invalidate nonexistent handled gracefully', badInv._text != null);

// Store + immediate round-trip
const rt = await callTool('store_memory', {
  content: 'Round-trip test: the user uses Neovim with LazyVim configuration for all editing'
});
const rtId = extractId(rt);
check('round-trip: store succeeds', rtId != null);

await new Promise(r => setTimeout(r, 500));

const rtQ = await callTool('query_memory', { query: 'what editor does the user use Neovim', limit: 5 });
const rtQr = rtQ._parsed;
const foundNvim = rtQr?.some(r => r.memory?.content?.includes('Neovim'));
check('round-trip: immediate query finds new memory', foundNvim, `top: ${rtQr?.slice(0,3).map(r => r.memory?.content?.substring(0,60))}`);

// === Summary ===
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} checks`);
console.log(`${'='.repeat(50)}`);

await client.close();
process.exit(failed > 0 ? 1 : 0);
