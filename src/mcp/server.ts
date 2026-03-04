import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { retrieve, setGlobalRetrievalParams } from "../agent/core/temporal/retrieval.js";
import { saveMemory } from "../agent/core/temporal/index.js";
import { deleteMemory, getMemoryStats, getMemory, updateMemoryMetadata } from "../agent/core/temporal/memoryStore.js";
import { prewarmModel } from "../agent/core/temporal/embedding.js";

// Pre-warm local embedding model in background
prewarmModel().catch(err => console.error("[EMBEDDING] Prewarm failed:", err));

// Prevent MCP stdout contamination by routing all logs to stderr
console.log = console.error;
console.info = console.error;
console.warn = console.error;
// Global server state for memory querying
let serverRetrievalTopK = 5;

const server = new Server(
    {
        name: "cognex-mcp",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "query_memory",
                description: "Query the agent's long-term episodic and semantic memory.",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "The search query to look up in memory" },
                        limit: { type: "number", description: "Maximum number of memory items to return (default 5)" }
                    },
                    required: ["query"]
                },
            },
            {
                name: "store_memory",
                description: "Explicitly store a new factual observation or experience into the temporal agent's memory graph.",
                inputSchema: {
                    type: "object",
                    properties: {
                        content: { type: "string", description: "The memory to store" }
                    },
                    required: ["content"]
                },
            },
            {
                name: "add_semantic_memory",
                description: "Reflect on episodic memories and synthesize them into a higher-level general semantic rule, fact, or insight.",
                inputSchema: {
                    type: "object",
                    properties: {
                        insight: { type: "string", description: "The general insight, fact, or behavioral rule to save." },
                        confidence: { type: "number", description: "How confident are you in this rule? 0.0 to 1.0 (defaults to 0.8)" }
                    },
                    required: ["insight"]
                }
            },
            {
                name: "invalidate_memory",
                description: "If a retrieved memory contains a false belief, hallucination, or outdated information, use this to permanently delete it.",
                inputSchema: {
                    type: "object",
                    properties: {
                        memory_id: { type: "string", description: "The exact UUID of the memory to delete" }
                    },
                    required: ["memory_id"]
                }
            },
            {
                name: "get_memory_stats",
                description: "Get statistics about the temporal memory graph, including the number of episodic and semantic memories, and the timestamp of the last reflection.",
                inputSchema: {
                    type: "object",
                    properties: {},
                }
            },
            {
                name: "create_hypothesis",
                description: "Create a new strategic hypothesis to track behavioral effectiveness over time.",
                inputSchema: {
                    type: "object",
                    properties: {
                        hypothesis: { type: "string", description: "The strategic hypothesis to test (e.g. 'Using findBy queries works better than getBy for async components')" },
                        confidence: { type: "number", description: "Initial confidence in this hypothesis (0.0 to 1.0) (defaults to 0.5)" }
                    },
                    required: ["hypothesis"]
                }
            },
            {
                name: "update_hypothesis",
                description: "Update an existing hypothesis to increment its evidence count or change its status/confidence.",
                inputSchema: {
                    type: "object",
                    properties: {
                        memory_id: { type: "string", description: "The UUID of the semantic hypothesis memory" },
                        confidence: { type: "number", description: "The updated confidence score (0.0 to 1.0)" },
                        evidence_increment: { type: "number", description: "Amount of new evidence collected (defaults to 1)" },
                        status: { type: "string", description: "Update status: 'active', 'confirmed', 'refuted', or 'stale'" }
                    },
                    required: ["memory_id"]
                }
            },
            {
                name: "tune_retrieval_params",
                description: "Tune the parameters of the memory retrieval system. Only supply the parameters you wish to change.",
                inputSchema: {
                    type: "object",
                    properties: {
                        topK: { type: "number", description: "Maximum number of memory items to return" },
                        spread_depth: { type: "number", description: "Maximum hops in spreading activation graph" },
                        link_threshold: { type: "number", description: "Minimum connection weight to traverse edges" },
                        alpha: { type: "number", description: "Frequency weight (promotes often-accessed memories)" },
                        beta: { type: "number", description: "Recency decay rate (penalizes older memories)" },
                    }
                }
            }
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        if (name === "query_memory") {
            const query = String(args?.query);
            const limit = args?.limit !== undefined ? Number(args.limit) : serverRetrievalTopK;

            const results = await retrieve(query, { topK: limit, useHybrid: true });
            return {
                content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
            };
        }

        else if (name === "store_memory") {
            const content = String(args?.content);
            const memoryId = await saveMemory({
                content,
                type: "episodic",
                importance: 0.5,
                source: "user_interaction"
            });
            return {
                content: [{ type: "text", text: `Stored memory with ID: ${memoryId}` }],
            };
        }

        else if (name === "add_semantic_memory") {
            const insight = String(args?.insight);
            const confidence = args?.confidence !== undefined ? Number(args?.confidence) : 0.8;

            const memoryId = await saveMemory({
                content: insight,
                type: "semantic",
                importance: confidence,
                source: "self_reflection"
            });
            return {
                content: [{ type: "text", text: `Synthesized semantic memory with ID: ${memoryId}` }],
            };
        }

        else if (name === "invalidate_memory") {
            const memory_id = String(args?.memory_id);
            const success = deleteMemory(memory_id);

            if (success) {
                return {
                    content: [{ type: "text", text: `Memory ${memory_id} successfully deleted from long-term storage.` }],
                };
            } else {
                return {
                    content: [{ type: "text", text: `Failed to delete memory ${memory_id}. It may not exist.` }],
                    isError: true,
                };
            }
        }

        else if (name === "create_hypothesis") {
            const hypothesis = String(args?.hypothesis);
            const confidence = args?.confidence !== undefined ? Number(args?.confidence) : 0.5;

            const memoryId = await saveMemory({
                content: hypothesis,
                type: "semantic",
                importance: 0.9,
                source: "self_reflection"
            });

            // Set initial hypothesis metadata
            updateMemoryMetadata(memoryId, {
                memory_type: 'hypothesis',
                evidence_count: 1,
                last_tested: new Date().toISOString(),
                confidence: confidence,
                status: 'active'
            });

            return {
                content: [{ type: "text", text: `Created hypothesis memory with ID: ${memoryId}` }],
            };
        }

        else if (name === "update_hypothesis") {
            const memoryId = String(args?.memory_id);
            const memory = getMemory(memoryId);

            if (!memory) {
                return {
                    content: [{ type: "text", text: `Memory ${memoryId} not found.` }],
                    isError: true,
                };
            }

            const currentEvidence = memory.metadata?.evidence_count || 0;
            const increment = args?.evidence_increment !== undefined ? Number(args?.evidence_increment) : 1;

            const updates: any = {
                last_tested: new Date().toISOString(),
                evidence_count: currentEvidence + increment,
            };

            if (args?.confidence !== undefined) updates.confidence = Number(args.confidence);
            if (args?.status !== undefined) updates.status = String(args.status);

            updateMemoryMetadata(memoryId, updates);

            return {
                content: [{ type: "text", text: `Updated hypothesis ${memoryId} metadata: ${JSON.stringify(updates)}` }],
            };
        }

        else if (name === "tune_retrieval_params") {
            const topK = args?.topK !== undefined ? Number(args.topK) : undefined;
            const spreadDepth = args?.spread_depth !== undefined ? Number(args.spread_depth) : undefined;
            const linkThreshold = args?.link_threshold !== undefined ? Number(args.link_threshold) : undefined;
            const alpha = args?.alpha !== undefined ? Number(args.alpha) : undefined;
            const beta = args?.beta !== undefined ? Number(args.beta) : undefined;

            if (topK !== undefined) serverRetrievalTopK = topK;

            const update: any = {};
            if (spreadDepth !== undefined) update.spread_depth = spreadDepth;
            if (linkThreshold !== undefined) update.link_threshold = linkThreshold;
            if (alpha !== undefined) update.alpha = alpha;
            if (beta !== undefined) update.beta = beta;

            const newParams = setGlobalRetrievalParams(update);

            return {
                content: [{ type: "text", text: `Updated retrieval parameters:\ntopK: ${serverRetrievalTopK}\n${JSON.stringify(newParams, null, 2)}` }],
            };
        }
        else if (name === "get_memory_stats") {
            const stats = getMemoryStats();
            return {
                content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
            };
        }

        else {
            throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error) {
        return {
            content: [{ type: "text", text: `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
        };
    }
});

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stdin.resume();
    console.error("Temporal Agent MCP Server running on stdio");
    const keepAlive = setInterval(() => undefined, 60_000);

    const shutdown = async () => {
        clearInterval(keepAlive);
        process.off("SIGINT", shutdown);
        process.off("SIGTERM", shutdown);
        try {
            await server.close();
        } catch {
            // Ignore close errors during shutdown.
        }
    };

    process.on("SIGINT", () => {
        void shutdown();
    });

    process.on("SIGTERM", () => {
        void shutdown();
    });
}

main().catch((error) => {
    console.error("Fatal error running server:", error);
    process.exit(1);
});
