# Telegram Adapter

Optional chat adapter used to exercise the temporal control architecture in long-running interactive sessions.

This adapter is **not required** for evaluation or core functionality. It provides a conversational interface for observing temporal memory, drive dynamics, and strategy selection in real-time.

## Setup

1. Create a bot with [@BotFather](https://t.me/botfather) on Telegram.
2. Copy the HTTP API Token.
3. Run the interactive setup:

```bash
npm run dev -- telegram setup
```

4. Follow the prompts to enter your token.

## Running the Bot

After setup, start the bot with:

```bash
npm run dev -- telegram
```

The terminal will display an **AUTH CODE**. Send `/auth <code>` to your bot in Telegram to authorize your account.
