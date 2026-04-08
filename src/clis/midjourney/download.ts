/**
 * MidJourney download — download a specific image by URL or job ID.
 *
 * If given a URL, downloads directly via browser fetch.
 * If given a job ID, navigates to the job page and extracts the image.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import { writeFileSync, mkdirSync } from 'node:fs';
import { checkLogin, MJ_IMAGINE_URL } from './utils.js';

cli({
  site: 'midjourney',
  name: 'download',
  description: 'MidJourney 下载指定图片',
  domain: 'www.midjourney.com',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  timeoutSeconds: 60,
  args: [
    {
      name: 'url',
      required: true,
      positional: true,
      help: '图片 URL 或 MJ job ID',
    },
    {
      name: 'output',
      default: './mj-output',
      help: '下载目录 (default: ./mj-output)',
    },
  ],
  columns: ['status', 'file', 'size'],
  func: async (page: IPage, kwargs) => {
    const input = kwargs.url as string;
    const outputDir = kwargs.output as string;

    let imageUrl = input;

    // If input looks like a job ID (not a URL), resolve it
    if (!input.startsWith('http')) {
      // Navigate to MJ to use cookies
      await page.goto(MJ_IMAGINE_URL);
      await page.wait(3);
      await checkLogin(page);

      // Try to find the image via API
      const resolved: string | null = await page.evaluate(`
        (async () => {
          try {
            const resp = await fetch('/api/jobs/${input}', { credentials: 'include' });
            if (!resp.ok) return null;
            const job = await resp.json();
            return job.image_paths?.[0] || job.thumbnail?.url || null;
          } catch { return null; }
        })()
      `);

      if (!resolved) {
        return [{ status: 'not_found', file: '', size: 0 }];
      }
      imageUrl = resolved;
    }

    // Download via browser fetch (to use cookies for CDN auth)
    await page.goto(MJ_IMAGINE_URL);
    await page.wait(2);

    const b64 = await page.evaluate(`
      (async () => {
        try {
          const r = await fetch(${JSON.stringify(imageUrl)});
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

    if (b64.error) {
      return [{ status: 'failed', file: b64.error, size: 0 }];
    }

    mkdirSync(outputDir, { recursive: true });
    const buf = Buffer.from(b64.data.split(',')[1], 'base64');
    const ext = (b64.type || 'image/png').split('/')[1] || 'png';
    const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fname = `${outputDir}/mj_download_${runId}.${ext}`;
    writeFileSync(fname, buf);

    return [{
      status: 'success',
      file: fname,
      size: buf.length,
    }];
  },
});
