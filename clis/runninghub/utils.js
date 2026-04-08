/**
 * RunningHub API utilities.
 *
 * RunningHub is a cloud ComfyUI platform with a task-based workflow:
 *   1. Submit task → get taskId
 *   2. Poll /query endpoint until SUCCEEDED / FAILED
 */
import { CliError } from '../../src/errors.js';
export const RUNNINGHUB_BASE = 'https://www.runninghub.cn';
export function getApiKey() {
    const key = process.env.RUNNINGHUB_API_KEY;
    if (!key) {
        throw new CliError('AUTH_ERROR', 'RUNNINGHUB_API_KEY environment variable is required', 'Get your API key from https://www.runninghub.cn and set: export RUNNINGHUB_API_KEY=xxx');
    }
    return key;
}
async function runninghubRequest(path, body) {
    const apiKey = getApiKey();
    const resp = await fetch(`${RUNNINGHUB_BASE}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new CliError('FETCH_ERROR', `RunningHub API HTTP ${resp.status}: ${text}`, 'Check your API key and request parameters');
    }
    const data = await resp.json();
    if (data.errorCode && data.errorCode !== 0) {
        throw new CliError('API_ERROR', `RunningHub error ${data.errorCode}: ${data.errorMessage ?? 'Unknown error'}`, 'Check the RunningHub API documentation for error details');
    }
    return data;
}
export async function submitTask(body) {
    return runninghubRequest('/openapi/v2/alibaba/wan-2.6/reference-to-video-flash', body);
}
export async function queryTask(taskId) {
    return runninghubRequest('/openapi/v2/query', { taskId });
}
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_MS = 600_000; // 10 minutes
export async function pollTask(taskId, debug = false) {
    const start = Date.now();
    while (Date.now() - start < MAX_POLL_MS) {
        const result = await queryTask(taskId);
        if (debug) {
            // eslint-disable-next-line no-console
            console.error(`[poll] taskId=${taskId} status=${result.status}`);
        }
        if (result.status === 'SUCCEEDED' || result.status === 'SUCCESS' || result.status === 'FAILED')
            return result;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new CliError('TIMEOUT', `Task ${taskId} did not complete within ${MAX_POLL_MS / 1000}s`, 'Try increasing timeout or check task status manually');
}
