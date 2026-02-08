/**
 * Time utilities - centralizes timestamp generation in IST (UTC+5:30)
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // +5:30 in milliseconds

/**
 * Get current time as an ISO 8601 string in IST (UTC+5:30)
 * Format: 2026-02-05T22:30:00.000+05:30
 */
export function nowIST(): string {
    const now = new Date();
    const ist = new Date(now.getTime() + IST_OFFSET_MS);
    // Build ISO string with +05:30 offset
    return ist.toISOString().replace('Z', '+05:30');
}

/**
 * Get current date string in IST (YYYY-MM-DD)
 */
export function todayIST(): string {
    return nowIST().split('T')[0];
}
