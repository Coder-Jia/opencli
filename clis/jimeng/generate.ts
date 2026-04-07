/**
 * Jimeng image — text-to-image generation.
 *
 * Strategy:
 * 1. Fill prompt + click generate (UI automation)
 * 2. Use built-in interceptor to capture generate API response → get history_record_id
 * 3. Actively poll get_history_by_ids until item_list has image URLs
 * 4. Download images via browser fetch
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';
import type { IPage } from '@jackwener/opencli/types';
import { writeFileSync, mkdirSync } from 'node:fs';

const JIMENG_IMAGE_URL = 'https://jimeng.jianying.com/ai-tool/generate?type=image&workspace=0';

cli({
  site: 'jimeng',
  name: 'generate',
  description: '即梦AI 文生图 — 输入 prompt 生成图片并下载',
  domain: 'jimeng.jianying.com',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  exclusive: true,
  timeoutSeconds: 300,
  args: [
    {
      name: 'prompt',
      required: true,
      positional: true,
      help: '图片描述 prompt',
    },
    {
      name: 'model',
      default: 'v50',
      choices: ['v50', 'v46', 'v45', 'v41', 'v40', 'v31'],
      help: '模型: v50 (5.0 Lite), v46 (4.6), v45 (4.5), v41 (4.1), v40 (4.0), v31 (3.1)',
    },
    {
      name: 'wait',
      type: 'int',
      default: 180,
      help: '等待生成完成的秒数 (default: 180)',
    },
    {
      name: 'ratio',
      default: '1:1',
      choices: ['1:1', '9:16', '16:9', '3:4', '4:3'],
      help: '图片比例 (default: 1:1)',
    },
    {
      name: 'output',
      default: './jimeng-output',
      help: '下载目录 (default: ./jimeng-output)',
    },
  ],
  columns: ['status', 'prompt', 'image_count', 'download_dir'],
  func: async (page: IPage, kwargs) => {
    const prompt = kwargs.prompt as string;
    const waitSec = kwargs.wait as number;
    const outputDir = kwargs.output as string;

    // Navigate to image generation page
    await page.goto(JIMENG_IMAGE_URL);
    await page.wait(5);

    // Check login
    const loggedIn = await page.evaluate(`
      (() => {
        const text = document.body.innerText || '';
        return text.includes('会员') || text.includes('我的')
          || text.includes('创作') || text.includes('历史')
          || !!document.querySelector('[class*=avatar], [class*=user], [class*=profile]');
      })()
    `);
    if (!loggedIn) {
      throw new AuthRequiredError('jimeng.jianying.com', 'Please log in to Jimeng in Chrome first');
    }

    // === STEP 1: Install interceptor for generate API ===
    await page.installInterceptor('aigc_draft/generate');

    // === STEP 2: Fill prompt ===
    await page.evaluate(`
      (async () => {
        const prompt = ${JSON.stringify(prompt)};
        const editor = document.querySelector('[contenteditable="true"]')
          || document.querySelector('textarea')
          || document.querySelector('[role="textbox"]');
        if (!editor) return;

        editor.focus();
        await new Promise(r => setTimeout(r, 300));
        document.execCommand('selectAll');
        document.execCommand('delete');
        await new Promise(r => setTimeout(r, 200));
        document.execCommand('insertText', false, prompt);
        await new Promise(r => setTimeout(r, 500));
      })()
    `);

    // === STEP 2b: Select ratio ===
    const targetRatio = kwargs.ratio as string;
    if (targetRatio !== '1:1') {
      // Step 1: Click the ratio/size dropdown button to open it
      const opened = await page.evaluate(`
        (() => {
          // The ratio button has text like "1:1高清 2K" with class "button-text-*"
          const btns = document.querySelectorAll('span[class*="button-text"], button[class*="btn"]');
          for (const btn of btns) {
            const text = btn.textContent?.trim() ?? '';
            if (/\\d+:\\d+/.test(text) && (text.includes('高清') || text.includes('K'))) {
              btn.click();
              // Also try clicking the parent button
              const parentBtn = btn.closest('button');
              if (parentBtn) parentBtn.click();
              return 'opened: ' + text;
            }
          }
          return 'not-opened';
        })()
      `);

      if (opened !== 'not-opened') {
        await page.wait(1);
        // Step 2: Click the ratio option in the dropdown
        const selected = await page.evaluate(`
          (() => {
            const target = ${JSON.stringify(targetRatio)};
            // Look for ratio options in the dropdown popup/menu
            const options = document.querySelectorAll('[class*="option"], [class*="menu-item"], [role="option"], [class*="select-option"], [class*="dropdown"] > div, [class*="popover"] > div');
            for (const opt of options) {
              const text = opt.textContent?.trim() ?? '';
              if (text.length > 20) continue;
              if (text.startsWith(target) || text.includes(target)) {
                opt.click();
                return 'selected: ' + text;
              }
            }
            // Fallback: scan all visible elements for ratio text
            const allEls = document.querySelectorAll('span, div, button, li');
            for (const el of allEls) {
              const text = el.textContent?.trim() ?? '';
              if (text.length > 15) continue;
              if (text === target || text.startsWith(target + ' ')) {
                el.click();
                return 'fallback: ' + text;
              }
            }
            // Collect debug info about what's visible
            const visible = [];
            for (const el of document.querySelectorAll('[class*="option"], [class*="menu"], [class*="popover"] *')) {
              const text = el.textContent?.trim() ?? '';
              if (text.length > 0 && text.length <= 20) visible.push(text);
            }
            return 'not-found|visible: ' + [...new Set(visible)].slice(0, 20).join('; ');
          })()
        `);
        // eslint-disable-next-line no-console
        console.error(`[ratio] open=${opened} select=${selected}`);
      } else {
        // eslint-disable-next-line no-console
        console.error(`[ratio] failed to open dropdown`);
      }
    }

    // === STEP 2c: Select model ===
    const targetModel = kwargs.model as string;
    const MODEL_LABELS: Record<string, string> = {
      'v50': '5.0 Lite',
      'v46': '4.6',
      'v45': '4.5',
      'v41': '4.1',
      'v40': '4.0',
      'v31': '3.1',
    };
    const modelLabel = MODEL_LABELS[targetModel] ?? targetModel;
    const modelResult: string = await page.evaluate(`
      (async () => {
        const targetLabel = ${JSON.stringify(modelLabel)};
        const debug = [];

        // Dump all select/dropdown-like elements
        const selects = document.querySelectorAll('[class*=select], [role=combobox], [class*=dropdown]');
        for (const sel of selects) {
          const text = sel.textContent?.trim()?.substring(0, 60) ?? '';
          debug.push('select: <' + sel.tagName + ' class="' + (sel.className?.toString?.()?.substring(0,50) ?? '') + '"> "' + text + '"');
        }

        // Try clicking select dropdowns to find model options
        for (const sel of selects) {
          const text = sel.textContent?.trim() ?? '';
          // Skip ratio/size related dropdowns
          if (/\\d+:\\d+/.test(text)) continue;
          if (text.includes(targetLabel)) {
            debug.push('already-selected: "' + text + '"');
            continue;
          }
          if (typeof sel.click !== 'function') continue;
          sel.click();
          await new Promise(r => setTimeout(r, 800));
          // Check for options in the opened dropdown
          const options = document.querySelectorAll('[role=option], [class*=option], [class*=menu-item], [class*=select-option], [class*=list-item]');
          debug.push('options-after-click: ' + options.length);
          for (const opt of options) {
            const optText = opt.textContent?.trim() ?? '';
            debug.push('  option: "' + optText.substring(0, 40) + '"');
            if (optText.includes(targetLabel)) {
              opt.click();
              return 'selected: ' + optText;
            }
          }
        }

        return 'not-found|' + debug.join('\\n');
      })()
    `);
    // eslint-disable-next-line no-console
    console.error(`[model] ${modelResult}`);
    await page.wait(0.5);

    // === STEP 3: Click generate button ===
    const clickResult = await page.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const genBtn = btns.find(b =>
          b.className.includes('circle') && b.className.includes('primary')
          && !b.className.includes('disabled') && !b.disabled
        );
        if (!genBtn) return { ok: false, error: 'Button disabled or not found' };
        genBtn.click();
        return { ok: true };
      })()
    `);

    if (!clickResult.ok) {
      return [{ status: 'failed', prompt: prompt.substring(0, 80), image_count: 0, download_dir: clickResult.error }];
    }

    // === STEP 4: Wait for generate API response, extract history_record_id ===
    let historyRecordId: string | null = null;

    for (let i = 0; i < 20; i++) {
      await page.wait(1);
      const intercepted: any[] = await page.getInterceptedRequests();
      for (const entry of intercepted) {
        const aigcData = entry?.data?.aigc_data;
        if (aigcData?.history_record_id) {
          historyRecordId = String(aigcData.history_record_id);
          break;
        }
      }
      if (historyRecordId) break;
    }

    if (!historyRecordId) {
      return [{ status: 'failed', prompt: prompt.substring(0, 80), image_count: 0, download_dir: 'No history_record_id captured' }];
    }

    // === STEP 5: Poll get_history_by_ids until item_list has image URLs ===
    let imageUrls: string[] = [];

    for (let i = 0; i < waitSec; i++) {
      await page.wait(1);

      const pollResult: string = await page.evaluate(`
        (async () => {
          try {
            const resp = await fetch('/mweb/v1/get_history_by_ids', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ history_ids: [${JSON.stringify(historyRecordId)}] }),
            });
            return await resp.text();
          } catch(e) { return ''; }
        })()
      `);

      if (!pollResult) continue;

      try {
        const json = JSON.parse(pollResult);
        const data = json?.data ?? {};
        // data is keyed by history_record_id
        for (const key of Object.keys(data)) {
          const record = data[key];
          if (!record) continue;
          const items: any[] = record.item_list ?? [];
          for (const item of items) {
            // Highest resolution: image.large_images[0].image_url (0:0 = original)
            const largeImg = item?.image?.large_images?.[0]?.image_url;
            if (largeImg) imageUrls.push(largeImg);
            // Cover URL map: pick largest available
            const coverMap = item?.common_attr?.cover_url_map ?? {};
            for (const size of ['4096', '2400', '1080', '720']) {
              if (coverMap[size]) { imageUrls.push(coverMap[size]); break; }
            }
            // Fallback cover URL
            const coverUrl = item?.common_attr?.cover_url;
            if (coverUrl) imageUrls.push(coverUrl);
          }
        }
      } catch { /* ignore parse errors */ }

      if (imageUrls.length > 0) break;
    }

    if (imageUrls.length === 0) {
      return [{ status: 'timeout', prompt: prompt.substring(0, 80), image_count: 0, download_dir: '' }];
    }

    // === STEP 6: Pick best resolution URLs ===
    const pickedUrls = pickBestUrls(imageUrls);

    // === STEP 7: Download images via browser fetch ===
    mkdirSync(outputDir, { recursive: true });
    const downloaded: string[] = [];

    for (let i = 0; i < pickedUrls.length; i++) {
      const url = pickedUrls[i];
      const b64 = await page.evaluate(`
        (async () => {
          try {
            const r = await fetch(${JSON.stringify(url)});
            if (!r.ok) return { error: 'HTTP ' + r.status };
            const blob = await r.blob();
            const rd = new FileReader();
            return new Promise(res => {
              rd.onload = () => res({ data: rd.result, size: blob.size, type: blob.type });
              rd.readAsDataURL(blob);
            });
          } catch(e) { return { error: e.message }; }
        })()
      `);

      if (b64.error) continue;
      const buf = Buffer.from(b64.data.split(',')[1], 'base64');
      const ext = (b64.type || 'image/webp').split('/')[1] || 'webp';
      const fname = `${outputDir}/img_${downloaded.length + 1}.${ext}`;
      writeFileSync(fname, buf);
      downloaded.push(fname);
    }

    return [{
      status: downloaded.length > 0 ? 'success' : 'partial',
      prompt: prompt.substring(0, 80),
      image_count: downloaded.length,
      download_dir: outputDir,
    }];
  },
});

/**
 * From a list of CDN URLs in various resolutions, pick the best ones.
 * Prefers 1080:1080, deduplicates by content hash.
 */
function pickBestUrls(urls: string[]): string[] {
  // Deduplicate
  const unique = [...new Set(urls)];

  // Group by content hash (the hex part before ~tplv)
  const groups = new Map<string, string[]>();
  for (const url of unique) {
    const match = url.match(/([a-f0-9]{32})~tplv/);
    const key = match ? match[1] : url;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(url);
  }

  const picked: string[] = [];
  for (const [, group] of groups) {
    // Prefer 1080 > 2400 > 640 > 4096 > 360, prefer webp > jpeg
    const scored = group.map(url => {
      let score = 0;
      if (url.includes(':1080:')) score += 100;
      else if (url.includes(':2400:')) score += 80;
      else if (url.includes(':640:')) score += 60;
      else if (url.includes(':4096:')) score += 50;
      else if (url.includes(':360:')) score += 30;
      if (url.endsWith('.webp')) score += 10;
      else if (url.endsWith('.jpeg')) score += 5;
      return { url, score };
    });
    scored.sort((a, b) => b.score - a.score);
    picked.push(scored[0].url);
  }

  return picked.slice(0, 4);
}
