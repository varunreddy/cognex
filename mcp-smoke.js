const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

(async () => {
    const client = new Client({ name: 'cognex-smoke', version: '1.0.0' });
    const transport = new StdioClientTransport({
        command: 'node',
        args: ['dist/src/mcp/server.js'],
        cwd: process.cwd(),
        stderr: 'pipe'
    });

    if (transport.stderr) {
        transport.stderr.on('data', d => process.stderr.write(`[cognex] ${d}`));
    }

    await client.connect(transport);
    const tools = await client.listTools();
    console.log('TOOLS:', tools.tools.map(t => t.name).join(', '));

    const stats = await client.callTool({ name: 'get_memory_stats', arguments: {} });
    console.log('MEMORY_STATS:', JSON.stringify(stats));

    await transport.close();
})().catch(err => {
    console.error('SMOKE_FAIL:', err);
    process.exit(1);
});
