/**
 * Report Generator — produces paper-ready markdown comparison tables.
 */

import * as fs from "fs";
import * as path from "path";
import { EvalRunResult, compareRuns, ComparisonRow } from "./metrics.js";
import { RetrospectiveReport } from "./retrospective.js";

const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), "eval_results");

// ---------------------------------------------------------------------------
// Load all results from a directory
// ---------------------------------------------------------------------------

export function loadAllResults(dir: string = DEFAULT_OUTPUT_DIR): EvalRunResult[] {
    if (!fs.existsSync(dir)) return [];

    const files = fs.readdirSync(dir)
        .filter(f => f.endsWith(".json") && !f.startsWith("retro") && !f.startsWith("report"))
        .sort();

    const results: EvalRunResult[] = [];
    for (const file of files) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
            if (data.label && data.aggregate) {
                results.push(data);
            }
        } catch {
            // skip malformed files
        }
    }
    return results;
}

// ---------------------------------------------------------------------------
// Markdown table generator
// ---------------------------------------------------------------------------

function markdownTable(headers: string[], rows: (string | number)[][]): string {
    const colWidths = headers.map((h, i) => {
        const maxRow = rows.reduce((m, r) => Math.max(m, String(r[i]).length), 0);
        return Math.max(h.length, maxRow);
    });

    const headerLine = "| " + headers.map((h, i) => h.padEnd(colWidths[i])).join(" | ") + " |";
    const separator = "| " + colWidths.map(w => "-".repeat(w)).join(" | ") + " |";
    const bodyLines = rows.map(
        r => "| " + r.map((v, i) => String(v).padEnd(colWidths[i])).join(" | ") + " |"
    );

    return [headerLine, separator, ...bodyLines].join("\n");
}

// ---------------------------------------------------------------------------
// Generate comparison report
// ---------------------------------------------------------------------------

export function generateComparisonReport(
    runs: EvalRunResult[],
    retroReport?: RetrospectiveReport,
    outputDir: string = DEFAULT_OUTPUT_DIR
): string {
    if (runs.length === 0 && !retroReport) {
        return "No data to generate report from.";
    }

    let md = "# Evaluation Report\n\n";
    md += `Generated: ${new Date().toISOString()}\n\n`;

    // --- Ablation comparison ---
    if (runs.length > 0) {
        md += "## Ablation Comparison\n\n";

        const compRows = compareRuns(runs);
        const headers = Object.keys(compRows[0] || {});
        const tableRows = compRows.map(r => headers.map(h => r[h]));
        md += markdownTable(headers, tableRows) + "\n\n";

        // Action distribution per condition
        md += "## Action Distribution by Condition\n\n";
        const allActions = new Set<string>();
        for (const r of runs) {
            for (const k of Object.keys(r.aggregate.action_distribution)) {
                allActions.add(k);
            }
        }
        const actionHeaders = ["condition", ...Array.from(allActions).sort()];
        const actionRows = runs.map(r => {
            const row: (string | number)[] = [r.label];
            for (const action of Array.from(allActions).sort()) {
                row.push(r.aggregate.action_distribution[action] || 0);
            }
            return row;
        });
        md += markdownTable(actionHeaders, actionRows) + "\n\n";

        // Per-cycle fitness data (CSV-like)
        md += "## Per-Cycle Fitness Deltas\n\n";
        md += "```csv\ncondition,cycle,fitness_delta,steps,exit_reason\n";
        for (const r of runs) {
            for (const c of r.cycles) {
                md += `${r.label},${c.cycle},${c.total_fitness_delta.toFixed(3)},${c.steps_used},${c.exit_reason}\n`;
            }
        }
        md += "```\n\n";
    }

    // --- Retrospective ---
    if (retroReport && retroReport.total_outcomes > 0) {
        md += "## Retrospective Analysis\n\n";
        md += `Total historical outcomes: ${retroReport.total_outcomes}\n`;
        if (retroReport.date_range) {
            md += `Date range: ${retroReport.date_range.first} → ${retroReport.date_range.last}\n`;
        }
        md += "\n";

        // Action distribution
        md += "### Historical Action Distribution\n\n";
        const sorted = Object.entries(retroReport.action_distribution).sort((a, b) => b[1] - a[1]);
        const distHeaders = ["action", "count", "percent"];
        const distRows = sorted.map(([action, count]) => [
            action,
            count,
            ((count / retroReport.total_outcomes) * 100).toFixed(1) + "%",
        ]);
        md += markdownTable(distHeaders, distRows) + "\n\n";

        // Strategy comparison
        md += "### Strategy Performance\n\n";
        const stratHeaders = ["strategy", "actions", "avg_upvotes", "avg_replies", "mod_rate"];
        const stratRows = retroReport.strategy_comparison.map(s => [
            s.strategy,
            s.action_count,
            s.mean_upvotes.toFixed(2),
            s.mean_replies.toFixed(2),
            (s.moderation_rate * 100).toFixed(1) + "%",
        ]);
        md += markdownTable(stratHeaders, stratRows) + "\n\n";

        // Stagnation
        md += "### Stagnation Analysis\n\n";
        md += `- Zero-outcome runs: ${retroReport.stagnation_runs.count}\n`;
        md += `- Longest run: ${retroReport.stagnation_runs.max_run}\n`;
        md += `- Mean run length: ${retroReport.stagnation_runs.mean_run.toFixed(1)}\n\n`;
    }

    // Write to file
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const reportPath = path.join(outputDir, `report_${Date.now()}.md`);
    fs.writeFileSync(reportPath, md);
    console.log(`[REPORT] Written to: ${reportPath}`);

    return md;
}

/** Print comparison table to console */
export function printComparison(runs: EvalRunResult[]): void {
    if (runs.length === 0) {
        console.log("No eval results to compare.");
        return;
    }

    const rows = compareRuns(runs);
    const headers = Object.keys(rows[0]);

    console.log("\n" + "═".repeat(80));
    console.log("  Ablation Comparison");
    console.log("═".repeat(80) + "\n");

    // Print header
    console.log(headers.map(h => h.padEnd(16)).join(""));
    console.log("-".repeat(headers.length * 16));

    // Print rows
    for (const row of rows) {
        console.log(headers.map(h => String(row[h]).padEnd(16)).join(""));
    }

    console.log();
}
