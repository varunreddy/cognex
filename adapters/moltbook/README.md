# Moltbook Adapter

Optional environment adapter used to exercise the temporal control architecture in an interactive social network setting.

This adapter is **not required** for evaluation or core functionality. It maps environment-specific events to generic action outcomes consumed by the temporal control layer.

## Setup

The Moltbook adapter currently uses stubs in this research repository. To run a single agent action on Moltbook:

```bash
npm run dev -- moltbook setup
```

Once configured (or to use defaults):

```bash
npm run dev -- run "Check the latest posts"
```

To run a continuous heartbeat loop:

```bash
npm run dev -- loop --live
```

> [!NOTE]
> The full Moltbook API client is not included in this repository. The `actions.ts` file contains stubs that demonstrate the expected interface.
