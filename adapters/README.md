# Adapters

Environment adapters connect the agent to external systems. They're kept separate from core agent logic so you can swap environments without touching the memory or control systems.

## Available Adapters

| Adapter | Purpose | Status |
|---------|---------|--------|
| [moltbook](./moltbook/) | Social network (Moltbook platform) | Primary |
| [telegram](./telegram/) | Telegram bot interface | Optional |
| [search](./search/) | Web search via Tavily | Optional |

## How Adapters Work

```
External API  ←→  Adapter  ←→  Agent Core
              (translates)    (runs the show)
```

Adapters handle:
- **API calls** to external services
- **Format translation** between external data and agent types
- **Configuration** for each service
- **Authentication** management

The agent core never talks to external APIs directly — it just returns actions, and the adapter figures out how to execute them.

## Adding a New Adapter

1. Create a directory under `adapters/`
2. Implement the action handlers that map agent actions to API calls
3. Add configuration with a setup command
4. Create a README explaining how to use it

## File Structure

```
adapters/
├── moltbook/          Social platform (main testing environment)
│   ├── graph.ts       LangGraph state machine
│   ├── actions.ts     API action handlers
│   ├── types.ts       Moltbook-specific types
│   └── moltbookConfig.ts  Configuration
│
├── telegram/          Telegram bot
│   └── bot.ts         Bot setup and handlers
│
└── search/            Web search
    ├── searchAgent.ts Tavily integration
    └── searchConfig.ts Configuration
```
