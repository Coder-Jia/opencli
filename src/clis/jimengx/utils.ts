/**
 * Jimeng (即梦) shared helpers: login check, combobox interaction,
 * progress monitoring, video URL extraction, concurrency lock.
 */

import type { IPage } from '@jackwener/opencli/types';
import { AuthRequiredError, SelectorError, CommandExecutionError } from '@jackwener/opencli/errors';
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

export const JIMENG_GENERATE_URL = 'https://jimeng.jianying.com/ai-tool/video/generate';

/** File-based lock to ensure only one jimeng task (image or video) runs at a time. */
const LOCK_FILE = join(tmpdir(), 'opencli-jimeng.lock');

function isProcessAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    if (process.platform === 'win32') {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /NH /FO CSV`, { timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
      return out.includes(`"${pid}"`);
    }
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire the jimeng concurrency lock.
 * Throws CommandExecutionError if another task is already running.
 * Writes current PID + timestamp to the lock file.
 */
export function acquireLock(): void {
  if (existsSync(LOCK_FILE)) {
    try {
      const content = readFileSync(LOCK_FILE, 'utf-8').trim();
      const [pidStr, tsStr] = content.split('|');
      const pid = Number(pidStr);
      const ts = Number(tsStr);
      const ageSec = (Date.now() - ts) / 1000;

      if (isProcessAlive(pid) && ageSec < 3600) {
        throw new CommandExecutionError(
          `Jimeng task already running (PID ${pid}, ${Math.round(ageSec)}s ago). Wait for it to finish.`,
        );
      }
      // Stale lock — remove it
      unlinkSync(LOCK_FILE);
    } catch (e: any) {
      if (e instanceof CommandExecutionError) throw e;
      // Corrupt lock file — remove it
      unlinkSync(LOCK_FILE);
    }
  }
  writeFileSync(LOCK_FILE, `${process.pid}|${Date.now()}`);
}

/** Release the jimeng concurrency lock. */
export function releaseLock(): void {
  try {
    if (existsSync(LOCK_FILE)) {
      const content = readFileSync(LOCK_FILE, 'utf-8').trim();
      if (content.startsWith(String(process.pid))) {
        unlinkSync(LOCK_FILE);
      }
    }
  } catch { /* best effort */ }
}

/** Model name mapping from CLI arg → display text in combobox */
const MODEL_DISPLAY: Record<string, string> = {
  'seedance2': 'Seedance 2.0',
  'seedance2-fast': 'Seedance 2.0 Fast',
  'seedance2-vip': 'Seedance 2.0 VIP',
  'seedance2-fast-vip': 'Seedance 2.0 Fast VIP',
  'video3-fast': '视频 3.0 Fast',
};

export function resolveModelName(input: string): string {
  return MODEL_DISPLAY[input] ?? input;
}

/** Check if the user is logged into Jimeng. Throws AuthRequiredError if not. */
export async function checkLogin(page: IPage): Promise<void> {
  const state = await page.evaluate(`
    (() => ({
      loggedIn: document.body.innerText.includes('会员'),
      configWrapper: !!document.querySelector('#dreamina-ui-configuration-content-wrapper'),
    }))()
  `);
  if (!state?.loggedIn) {
    throw new AuthRequiredError('jimeng.jianying.com', 'Please log in to Jimeng in Chrome first');
  }
  if (!state?.configWrapper) {
    throw new SelectorError('#dreamina-ui-configuration-content-wrapper',
      'Page may not have fully loaded. Try again.');
  }
}

/** Read the current text of all [role=combobox] elements. */
export async function readComboboxes(page: IPage): Promise<string[]> {
  return page.evaluate(`
    (() => Array.from(document.querySelectorAll('[role=combobox]'))
      .map(c => c.textContent.trim().substring(0, 30)))
  `);
}

/**
 * Select an option in a combobox by its index and target option text.
 *
 * 1. Click the combobox at `index` to open it
 * 2. Wait 500ms for the dropdown to render
 * 3. Find the option containing `targetText` and click it
 * 4. Wait 500ms for the selection to apply
 */
export async function selectComboboxOption(
  page: IPage,
  index: number,
  targetText: string,
): Promise<void> {
  const err = await page.evaluate(`
    (async () => {
      const combos = document.querySelectorAll('[role=combobox]');
      const combo = combos[${JSON.stringify(index)}];
      if (!combo) return 'Combobox index ${index} not found';

      combo.click();
      await new Promise(r => setTimeout(r, 500));

      const target = ${JSON.stringify(targetText)};
      const options = document.querySelectorAll('[role=option], [role=listbox] li, [class*=option]');

      // 1. Exact match (trimmed text equals target)
      let found = null;
      for (const opt of options) {
        const text = opt.textContent.trim();
        if (text === target) { found = opt; break; }
      }

      // 2. Exact match but ignoring "VIP" suffix to avoid selecting VIP when non-VIP is wanted
      if (!found) {
        for (const opt of options) {
          const text = opt.textContent.trim();
          // Match "Seedance 2.0" but NOT "Seedance 2.0 VIP"
          if (text.startsWith(target) && !text.includes('VIP')) { found = opt; break; }
        }
      }

      // 3. Fallback: includes match
      if (!found) {
        for (const opt of options) {
          if (opt.textContent.includes(target)) { found = opt; break; }
        }
      }

      if (!found) {
        combo.click();
        return 'Option "' + target + '" not found in combobox ${index}';
      }

      found.click();
      await new Promise(r => setTimeout(r, 500));
      return null;
    })()
  `);

  if (err) {
    throw new SelectorError(`combobox[${index}] option "${targetText}"`, err as string);
  }
}

/** Read the generation progress badge text. Returns null if no active task. */
export async function readProgress(page: IPage): Promise<string | null> {
  return page.evaluate(`
    (() => {
      const badge = document.querySelector('[class*=progress-badge]');
      return badge ? badge.textContent.trim() : null;
    })()
  `);
}

/**
 * Select a ratio radio button (16:9, 4:3, 3:4).
 * Clicks the ratio group button first to expand, then clicks the matching radio.
 */
export async function selectRatio(page: IPage, ratio: string): Promise<void> {
  const err = await page.evaluate(`
    (async () => {
      const target = ${JSON.stringify(ratio)};
      // Find all radio inputs, look for one whose label contains the target ratio
      const radios = document.querySelectorAll('input[type=radio]');
      for (const radio of radios) {
        const label = radio.closest('label')
          || radio.parentElement
          || radio.closest('[class*=radio]');
        if (label && label.textContent.includes(target)) {
          radio.click();
          // Also try clicking the label/parent for better React state sync
          label.click();
          return null;
        }
      }

      // Fallback: look for clickable elements containing the ratio text
      const spans = document.querySelectorAll('span, div[role=radio], label');
      for (const el of spans) {
        const text = el.textContent.trim();
        if (text === target || text === target.replace('/', ':')) {
          el.click();
          return null;
        }
      }

      return 'Ratio "${ratio}" not found';
    })()
  `);

  if (err) {
    throw new SelectorError(`ratio ${ratio}`, err as string);
  }
}

/**
 * Fill the prompt textarea with the given text.
 * Presses Escape first to close any floating panels.
 */
export async function fillPrompt(page: IPage, prompt: string): Promise<void> {
  await page.pressKey('Escape');
  await page.wait(0.3);

  const err = await page.evaluate(`
    (() => {
      // Try contenteditable div first (current Jimeng UI), then textarea fallback
      const editor = document.querySelector('[contenteditable="true"]')
        || document.querySelector('textarea[placeholder*="输入文字"], textarea');
      if (!editor) return 'Prompt editor not found';

      // Focus and clear existing content
      editor.focus();
      document.execCommand('selectAll');
      document.execCommand('delete');

      // For contenteditable: use execCommand to insert text (preserves React state)
      // For textarea: use native value setter + input event
      if (editor.tagName === 'TEXTAREA') {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        ).set;
        setter.call(editor, ${JSON.stringify(prompt)});
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        document.execCommand('insertText', false, ${JSON.stringify(prompt)});
      }
      return null;
    })()
  `);

  if (err) {
    throw new SelectorError('[contenteditable] or textarea', err as string);
  }
}

/** Click the submit button to start generation. */
export async function clickSubmit(page: IPage): Promise<void> {
  const result = await page.evaluate(`
    (() => {
      const btn = document.querySelector(
        '#dreamina-ui-configuration-content-wrapper button[class*=submit-button]'
      );
      if (!btn) return 'Submit button not found';
      btn.click();
      return 'ok';
    })()
  `);

  if (result !== 'ok') {
    throw new SelectorError('button[class*=submit-button]', result as string);
  }
}

/** Get all video records from the page. Returns array of {recordId, preview}. */
export async function getRecordList(page: IPage): Promise<Array<{recordId: string; preview: string}>> {
  return page.evaluate(`
    (() => Array.from(document.querySelectorAll('[id^=item_]'))
      .map(el => {
        const parts = el.id.split('_');
        return {
          recordId: parts[parts.length - 1],
          preview: el.textContent.substring(0, 80).replace(/\\n/g, ' ').trim(),
        };
      }))
  `);
}

/** Navigate to the generate page and ensure it's loaded. */
export async function navigateToGenerate(page: IPage): Promise<void> {
  await page.goto(JIMENG_GENERATE_URL);
  await page.wait(3);
  await checkLogin(page);
}
