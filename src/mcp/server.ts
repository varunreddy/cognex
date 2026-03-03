import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getDrivePrompt } from "../agent/core/drives.js";
import { updateFitness } from "../agent/core/fitness.js";
import { retrieve } from "../agent/core/temporal/retrieval.js";
import { saveMemory } from "../agent/core/temporal/index.js";

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
                name: "get_drive_state",
                description: "Get the current motivational drives of the agent (e.g. connection, novelty, achievement). Useful to decide what to do next autonomously.",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
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
                name: "report_task_outcome",
                description: "Report back the outcome of an action taken (e.g. using a skill, running code) to update the agent's internal fitness score.",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", description: "The action taken (e.g., TOOL_EXECUTION, WRITE_CODE, READ_FILE)" },
                        success_score: { type: "number", description: "1.0 for success, 0.0 for failure, or anywhere in between" },
                        error_count: { type: "number", description: "Number of errors encountered (if any, default 0)" },
                        is_task_success: { type: "boolean", description: "Whether the overall task was a success" }
                    },
                    required: ["action", "success_score"]
                },
            }
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        if (name === "get_drive_state") {
            const state = getDrivePrompt();
            return {
                content: [{ type: "text", text: state }],
            };
        }

        else if (name === "query_memory") {
            const query = String(args?.query);
            const limit = Number(args?.limit || 5);

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

        else if (name === "report_task_outcome") {
            const action = String(args?.action);
            const success_score = Number(args?.success_score);
            const error_count = args?.error_count !== undefined ? Number(args?.error_count) : 0;
            const is_task_success = args?.is_task_success !== undefined ? Boolean(args?.is_task_success) : undefined;

            const fitness = updateFitness({
                action,
                success_score,
                error_count,
                is_task_success
            });

            return {
                content: [{ type: "text", text: `Updated fitness. New overall fitness: ${fitness.overall_fitness.toFixed(2)}` }],
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
    console.error("Temporal Agent MCP Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error running server:", error);
    process.exit(1);
});
