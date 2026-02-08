import { Telegraf, Context } from "telegraf";
// Telegram config stubs (not included in research repo)
function loadTelegramConfig(): any { return { bot_token: "", authorized_users: [] }; }
function saveTelegramConfig(_config: any): void {}
function addAuthorizedUser(_userId: number): void {}
function isAuthorized(_userId: number): boolean { return false; }
import { runMoltbookAgent } from "../moltbook/graph";
import * as readline from "readline";

// Generate a random 6-digit code
function generateSecretCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function setupTelegramBot(): Promise<void> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const question = (query: string) => new Promise<string>((resolve) => rl.question(query, resolve));

    console.log("\n🤖 Telegram Bot Setup\n");
    console.log("1. Create a bot with @BotFather on Telegram");
    console.log("2. Copy the HTTP API Token");

    const token = await question("Enter Bot Token: ");
    rl.close();

    if (!token) {
        console.error("Token is required!");
        return;
    }

    const config = loadTelegramConfig();
    config.bot_token = token.trim();
    saveTelegramConfig(config);

    console.log("\n✅ Configuration saved!");
    console.log("Run 'npm run dev -- telegram' to start the bot.");
}

export async function startTelegramBot(): Promise<void> {
    const config = loadTelegramConfig();
    if (!config.bot_token) {
        console.error("❌ No bot token found. Run 'npm run dev -- telegram setup' first.");
        return;
    }

    const bot = new Telegraf(config.bot_token);
    const secretCode = generateSecretCode();

    console.log(`
🚀 Bot is running!
🔑 AUTH CODE: ${secretCode}

To authorize yourself:
1. Open your bot in Telegram
2. Send: /auth ${secretCode}
`);

    // --- Middleware: Log Incoming Messages ---
    bot.use(async (ctx: Context, next: () => Promise<void>) => {
        if (ctx.message && 'text' in ctx.message) {
            const user = ctx.from?.username || ctx.from?.id;
            console.log(`[TELEGRAM] Msg from ${user}: ${ctx.message.text}`);
        }
        await next();
    });

    // --- Command: /start ---
    bot.start((ctx: Context) => {
        ctx.reply("Hello! I am your Moltbook Agent. 🤖\n\nPlease authorize yourself with: /auth <code_from_terminal>");
    });

    // --- Command: /auth <code> ---
    bot.command("auth", (ctx: Context) => {
        // @ts-ignore - message.text exists on command updates
        const args = ctx.message?.text.split(" ") || [];
        const code = args[1];

        if (code === secretCode) {
            if (ctx.from) {
                addAuthorizedUser(ctx.from.id);
                ctx.reply("✅ Authorized! You can now chat with me.");
                console.log(`[AUTH] User ${ctx.from.username} (${ctx.from.id}) authorized successfully.`);
            }
        } else {
            ctx.reply("❌ Invalid code.");
        }
    });

    // --- Message Handler ---
    bot.on("text", async (ctx: Context) => {
        if (!ctx.from) return;
        const userId = ctx.from.id;

        if (!isAuthorized(userId)) {
            ctx.reply("🔒 Unauthorized. Please send /auth <code>");
            return;
        }

        // @ts-ignore - text exists on text updates
        const userMessage = ctx.message.text;

        // Indicate typing...
        ctx.sendChatAction("typing");

        try {
            // Run Agent in CHAT mode
            const result = await runMoltbookAgent(userMessage, { mode: "chat" });

            // Extract the response
            // We look at the history for 'reply_to_user' actions
            const responseActions = result.history.filter((a: any) => a.type === "reply_to_user");

            if (responseActions.length > 0) {
                for (const action of responseActions) {
                    await ctx.reply(action.parameters.content);
                }
            } else {
                // If the agent did something else (e.g. searched web) but didn't reply directly,
                // we should probably summarize what it did.
                // Or, if it used 'create_post', tell the user.

                // Fallback: Check summary text
                if (result.summary?.summary_text) {
                    // Clean up the summary text if it looks like a raw error
                    const summary = result.summary.summary_text;
                    if (summary.startsWith("Failed:")) {
                        await ctx.reply(`😕 I got stuck: ${summary.replace("Failed:", "").trim()}`);
                    } else if (summary.includes("[Agent Execution Summary]")) {
                        await ctx.reply(summary.replace("[Agent Execution Summary]:", "").trim());
                    } else {
                        await ctx.reply(summary);
                    }
                } else {
                    await ctx.reply("✅ Done (Action completed silently).");
                }
            }

        } catch (error: any) {
            console.error("Agent execution failed:", error);
            ctx.reply(`❌ Error: ${error.message}`);
        }
    });

    // Handle signals
    process.once("SIGINT", () => bot.stop("SIGINT"));
    process.once("SIGTERM", () => bot.stop("SIGTERM"));

    await bot.launch();
}
