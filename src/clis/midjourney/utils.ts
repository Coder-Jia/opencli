/**
 * MidJourney shared helpers: login check, prompt filling,
 * generate button, progress monitoring, history extraction.
 *
 * NOTE: MidJourney DOM selectors may need adjustment based on
 * actual page structure. Debug info is logged via console.error.
 */

import type { IPage } from '@jackwener/opencli/types';
import { AuthRequiredError, SelectorError } from '@jackwener/opencli/errors';

export const MJ_IMAGINE_URL = 'https://www.midjourney.com/imagine';
export const MJ_HOME_URL = 'https://www.midjourney.com';

/** Navigate to the imagine page and verify login. */
export async function navigateToImagine(page: IPage): Promise<void> {
  await page.goto(MJ_IMAGINE_URL);
  await page.wait(5);
  await checkLogin(page);
}

/**
 * Check if the user is logged into MidJourney.
 * Throws AuthRequiredError if not.
 *
 * Detection strategy:
 * - Check for avatar / user profile elements
 * - Check for the absence of login/signup buttons
 * - Check URL redirect (MJ redirects to /auth if not logged in)
 */
export async function checkLogin(page: IPage): Promise<void> {
  const state = await page.evaluate(`
    (() => {
      const url = window.location.href;
      const bodyText = document.body?.innerText || '';

      // If redirected to auth page
      if (url.includes('/auth') || url.includes('/login') || url.includes('/signup')) {
        return { loggedIn: false, reason: 'redirected to auth page', url };
      }

      // Check for common logged-in indicators
      const hasAvatar = !!document.querySelector(
        '[class*="avatar"], [class*="user-avatar"], [data-testid*="avatar"], img[alt*="avatar"]'
      );
      const hasUserMenu = !!document.querySelector(
        '[class*="user-menu"], [class*="profile"], [data-testid*="user"]'
      );
      const hasImagineInput = !!document.querySelector(
        'textarea, [contenteditable="true"], [role="textbox"], [class*="prompt"]'
      );
      const hasLoginBtn = bodyText.includes('Log in') || bodyText.includes('Sign up') || bodyText.includes('Sign in');

      // Debug dump
      console.error('[MJ checkLogin] url=' + url +
        ' hasAvatar=' + hasAvatar +
        ' hasUserMenu=' + hasUserMenu +
        ' hasImagineInput=' + hasImagineInput +
        ' hasLoginBtn=' + hasLoginBtn);

      // Logged in if we have avatar/user menu OR imagine input without login button
      const loggedIn = hasAvatar || hasUserMenu || (hasImagineInput && !hasLoginBtn);
      return { loggedIn, reason: loggedIn ? 'ok' : 'no logged-in indicators found' };
    })()
  `);

  if (!state?.loggedIn) {
    throw new AuthRequiredError(
      'www.midjourney.com',
      'Please log in to MidJourney in Chrome first. Reason: ' + (state?.reason || 'unknown'),
    );
  }
}

/**
 * Fill the prompt input with the given text.
 * Handles textarea, contenteditable div, and role="textbox" variants.
 */
export async function fillPrompt(page: IPage, prompt: string): Promise<void> {
  // Close any floating panels first
  await page.pressKey('Escape');
  await page.wait(0.3);

  const err = await page.evaluate(`
    (() => {
      const promptText = ${JSON.stringify(prompt)};

      // Try selectors in order of preference
      const editor =
        document.querySelector('[class*="prompt"] textarea') ||
        document.querySelector('[class*="imagine"] textarea') ||
        document.querySelector('[contenteditable="true"]') ||
        document.querySelector('textarea[placeholder]') ||
        document.querySelector('textarea') ||
        document.querySelector('[role="textbox"]');

      if (!editor) {
        // Debug: dump all input-like elements
        const inputs = Array.from(document.querySelectorAll('textarea, input, [contenteditable], [role="textbox"]'));
        console.error('[MJ fillPrompt] No editor found. Inputs on page: ' +
          inputs.map(e => '<' + e.tagName + ' class="' + (e.className || '').toString().substring(0, 50) + '">').join(', '));
        return 'Prompt editor not found';
      }

      console.error('[MJ fillPrompt] Found editor: <' + editor.tagName + '> class="' + (editor.className || '').toString().substring(0, 80) + '"');

      editor.focus();

      if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
        // Use native value setter to trigger React state update
        const setter = Object.getOwnPropertyDescriptor(
          editor.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
          'value'
        )?.set;
        if (setter) {
          setter.call(editor, promptText);
          editor.dispatchEvent(new Event('input', { bubbles: true }));
          editor.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          // Fallback: select all + insertText
          document.execCommand('selectAll');
          document.execCommand('delete');
          document.execCommand('insertText', false, promptText);
        }
      } else {
        // contenteditable
        document.execCommand('selectAll');
        document.execCommand('delete');
        document.execCommand('insertText', false, promptText);
      }

      return null;
    })()
  `);

  if (err) {
    throw new SelectorError('prompt editor', err as string);
  }
}

/**
 * Click the generate/submit button.
 * Tries multiple selector strategies.
 */
export async function clickGenerate(page: IPage): Promise<void> {
  const result = await page.evaluate(`
    (() => {
      // Strategy 1: button with generate/submit in class or text
      const btns = Array.from(document.querySelectorAll('button'));

      // Try to find by aria-label or text content
      let btn = btns.find(b => {
        const text = (b.textContent || '').trim().toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        return text === 'generate' || text === 'submit' || text === 'imagine' ||
               aria === 'generate' || aria === 'submit' || aria === 'imagine';
      });

      // Strategy 2: button with specific class patterns
      if (!btn) {
        btn = btns.find(b => {
          const cls = b.className || '';
          return (cls.includes('generate') || cls.includes('submit') || cls.includes('imagine'))
            && !cls.includes('disabled') && !b.disabled;
        });
      }

      // Strategy 3: the last prominent button (often the submit button)
      if (!btn) {
        const visible = btns.filter(b => {
          const rect = b.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && !b.disabled;
        });
        // Look for a button with a send/arrow icon or near the input
        btn = visible.find(b => {
          const svg = b.querySelector('svg');
          return svg && b.closest('[class*="prompt"], [class*="input"], [class*="compose"]');
        }) || visible.find(b => {
          const cls = (b.className || '').toLowerCase();
          return cls.includes('primary') || cls.includes('accent') || cls.includes('blue');
        });
      }

      if (!btn) {
        const debug = btns.filter(b => {
          const r = b.getBoundingClientRect();
          return r.width > 0;
        }).map(b => {
          const text = (b.textContent || '').trim().substring(0, 30);
          const cls = (b.className || '').toString().substring(0, 60);
          return '<button class="' + cls + '">' + text + '</button>';
        });
        console.error('[MJ clickGenerate] No button found. Visible buttons: ' + debug.join('; '));
        return 'Generate button not found';
      }

      console.error('[MJ clickGenerate] Clicking: <button class="' + (btn.className || '').toString().substring(0, 60) + '">' + (btn.textContent || '').trim().substring(0, 30) + '</button>');
      btn.click();
      return 'ok';
    })()
  `);

  if (result !== 'ok') {
    throw new SelectorError('generate button', result as string);
  }
}

/**
 * Read the generation progress/status.
 * Returns a status string or null if no active task.
 */
export async function readProgress(page: IPage): Promise<string | null> {
  return page.evaluate(`
    (() => {
      // Check for progress indicators
      const progress = document.querySelector(
        '[class*="progress"], [class*="loading"], [role="progressbar"], [class*="spinner"]'
      );
      if (progress) return progress.textContent?.trim() || 'generating';

      // Check for percentage text
      const allText = document.body.innerText || '';
      const pctMatch = allText.match(/(\\d+)\\s*%/);
      if (pctMatch) return pctMatch[0] + ' complete';

      return null;
    })()
  `);
}

/**
 * Build the full MJ prompt string with parameter flags.
 * Appends --ar, --v, --stylize, --quality to the base prompt.
 */
export function buildMjPrompt(
  prompt: string,
  opts: { ar?: string; v?: string; niji?: string; stylize?: number; quality?: string },
): string {
  let full = prompt;
  if (opts.ar) full += ` --ar ${opts.ar}`;
  if (opts.niji) {
    full += ` --niji ${opts.niji}`;
  } else if (opts.v) {
    full += ` --v ${opts.v}`;
  }
  if (opts.stylize !== undefined && opts.stylize !== 100) full += ` --stylize ${opts.stylize}`;
  if (opts.quality && opts.quality !== '1') full += ` --quality ${opts.quality}`;
  return full;
}

/**
 * Snapshot all CDN image URLs currently on the page.
 */
export async function snapshotImageUrls(page: IPage): Promise<Set<string>> {
  const urls: string[] = await page.evaluate(`
    (() => Array.from(document.querySelectorAll('img[src*="cdn.midjourney"], img[src*="discord"]'))
      .map(img => img.src)
      .filter(u => u && u.length > 30))()
  `);
  return new Set(urls);
}

/**
 * Wait for NEW image generation to complete by polling the DOM.
 * Compares against existingUrls to detect newly appeared images.
 *
 * @returns Array of new image URLs found, or empty if timeout
 */
export async function waitForNewImages(page: IPage, waitSec: number, existingUrls: Set<string>): Promise<string[]> {
  // First few seconds: generation just started, skip fast checks
  await page.wait(3);

  for (let i = 0; i < waitSec; i++) {
    await page.wait(1);

    const result: string[] = await page.evaluate(`
      (() => {
        const urls = Array.from(document.querySelectorAll('img[src*="cdn.midjourney"], img[src*="discord"]'))
          .map(img => img.src)
          .filter(u => u && u.length > 30);
        return urls;
      })()
    `);

    // Debug every 30 seconds in verbose mode
    if (i > 0 && i % 30 === 0) {
      console.error('[MJ waitForNewImages] waiting ' + (i + 3) + 's... (total=' + result.length + ' existing=' + existingUrls.size + ')');
    }

    // Check if we have NEW URLs not in the existing set
    const newUrls = result.filter(u => !existingUrls.has(u));
    if (newUrls.length >= 4) {
      console.error('[MJ waitForNewImages] Found ' + newUrls.length + ' new images after ' + (i + 3) + 's');
      return newUrls;
    }

    // Also check for upscale buttons as a completion signal
    const hasUpscale: boolean = await page.evaluate(`
      (() => {
        const btns = document.querySelectorAll('button');
        return Array.from(btns).some(b => {
          const t = (b.textContent || '').trim();
          return /^U[1-4]$/.test(t) || t.includes('Upscale');
        });
      })()
    `);

    if (hasUpscale) {
      // Upscale buttons appeared — grab the newest images
      if (newUrls.length > 0) {
        console.error('[MJ waitForNewImages] Upscale buttons + ' + newUrls.length + ' new images after ' + (i + 3) + 's');
        return newUrls;
      }
      // Buttons appeared but images still loading, wait a bit more
      await page.wait(2);
      const lateResult: string[] = await page.evaluate(`
        (() => Array.from(document.querySelectorAll('img[src*="cdn.midjourney"], img[src*="discord"]'))
          .map(img => img.src)
          .filter(u => u && u.length > 30))()
      `);
      const lateNew = lateResult.filter(u => !existingUrls.has(u));
      if (lateNew.length > 0) {
        console.error('[MJ waitForNewImages] Late images after upscale: ' + lateNew.length);
        return lateNew;
      }
    }
  }

  console.error('[MJ waitForNewImages] Timeout after ' + (waitSec + 3) + 's');
  return [];
}

/**
 * Get the history/generation list from the MJ page.
 * Navigates to the home/creations page and extracts job data.
 */
export async function getHistoryList(
  page: IPage,
  limit: number,
): Promise<Array<{ job_id: string; prompt: string; status: string; created_at: string; thumbnail: string }>> {
  // Try API first
  const apiResult = await page.evaluate(`
    (async () => {
      try {
        const resp = await fetch('/api/jobs?amount=${limit}&jobType=generate', {
          credentials: 'include',
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        if (!Array.isArray(data)) return null;
        return data.slice(0, ${limit}).map(job => ({
          job_id: job.id || job.job_id || '',
          prompt: job.prompt || job.full_command || '',
          status: job.status || 'unknown',
          created_at: job.enqueue_time || job.created_at || '',
          thumbnail: job.image_paths?.[0] || job.thumbnail?.url || '',
        }));
      } catch (e) {
        console.error('[MJ history] API error:', e.message);
        return null;
      }
    })()
  `);

  if (apiResult && Array.isArray(apiResult)) return apiResult;

  // Fallback: DOM scraping from imagine page
  await page.goto(MJ_IMAGINE_URL);
  await page.wait(5);

  // Step 2: Smart extraction — group by job_id, extract prompt from React fiber
  return page.evaluate(`
    (() => {
      const results = [];
      const seenJobs = new Set();

      // Find all cdn images
      const cdnImgs = document.querySelectorAll('img[src*="cdn.midjourney.com"], img[src*="cdn.discordapp"], img[src*="media.discordapp"]');

      for (const img of Array.from(cdnImgs)) {
        if (results.length >= ${limit}) break;
        const src = img.src;
        if (src.length < 30) continue;

        // Extract job_id from CDN URL: https://cdn.midjourney.com/HASH/index_N_size.webp
        const urlMatch = src.match(/midjourney\\.com\\/([a-f0-9-]+)\\//);
        const jobId = urlMatch ? urlMatch[1] : '';

        // Skip if we already have this job (4 images = 1 job)
        if (jobId && seenJobs.has(jobId)) continue;
        if (jobId) seenJobs.add(jobId);

        // Extract prompt from React fiber props on img parent elements
        let prompt = '';
        let el = img;
        for (let depth = 0; depth < 8 && el; depth++) {
          const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactProps'));
          if (fiberKey) {
            const props = el[fiberKey];
            // Walk memoizedProps / children / props chain to find prompt text
            const stack = [props];
            while (stack.length > 0) {
              const node = stack.pop();
              if (!node) continue;
              if (typeof node === 'string' && node.length > 15 && node.length < 1000 && !node.startsWith('http')) {
                prompt = node;
                break;
              }
              if (typeof node === 'object' && node !== null) {
                for (const key of ['prompt', 'full_command', 'text', 'children', 'props', 'memoizedProps']) {
                  if (node[key]) stack.push(node[key]);
                }
              }
            }
            if (prompt) break;
          }
          el = el.parentElement;
        }

        // Fallback: scan DOM text near the image
        if (!prompt) {
          let card = img.parentElement;
          for (let i = 0; i < 6 && card; i++) {
            const spans = card.querySelectorAll('span, p');
            for (const s of spans) {
              const t = s.textContent?.trim() || '';
              if (t.length > 15 && t.length < 500 && s.children.length === 0) {
                prompt = t;
                break;
              }
            }
            if (prompt) break;
            card = card.parentElement;
          }
        }

        // Collect all images for this job
        const thumbnails = [];
        if (jobId) {
          for (const otherImg of Array.from(cdnImgs)) {
            if (otherImg.src.includes(jobId)) thumbnails.push(otherImg.src);
          }
        } else {
          thumbnails.push(src);
        }

        results.push({
          job_id: jobId,
          prompt: prompt.substring(0, 200),
          status: 'completed',
          created_at: '',
          thumbnail: thumbnails[0],
          thumbnails: thumbnails,
        });
      }

      console.error('[MJ history] Extracted ' + results.length + ' unique jobs');
      return results.map(r => ({
        job_id: r.job_id,
        prompt: r.prompt,
        status: r.status,
        created_at: r.created_at,
        thumbnail: r.thumbnail + (r.thumbnails.length > 1 ? ' (+' + (r.thumbnails.length - 1) + ' more)' : ''),
      }));
    })()
  `);
}
