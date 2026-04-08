/**
 * MidJourney imagine — text-to-image generation.
 *
 * Strategy:
 * 1. Navigate to midjourney.com/imagine, check login
 * 2. Install network interceptor to capture submit/generate API response
 * 3. Build full prompt with MJ parameters (--ar, --v, --stylize, --quality)
 * 4. Fill prompt input and click generate
 * 5. Extract job_id from intercepted API response
 * 6. Wait for generation to complete (poll DOM for images)
 * 7. Download generated images to local directory
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import { writeFileSync, mkdirSync } from 'node:fs';
import {
  navigateToImagine,
  fillPrompt,
  clickGenerate,
  buildMjPrompt,
  snapshotImageUrls,
  waitForNewImages,
} from './utils.js';

cli({
  site: 'midjourney',
  name: 'imagine',
  description: 'MidJourney 文生图 — 输入 prompt 生成图片并下载',
  domain: 'www.midjourney.com',
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
      name: 'ar',
      default: '1:1',
      help: '宽高比 (default: 1:1), 如 16:9, 9:16, 4:3, 3:2',
    },
    {
      name: 'v',
      default: '6.1',
      help: 'MJ 模型版本 (default: 6.1), 如 6.1, 6, 5.2',
    },
    {
      name: 'niji',
      help: 'Niji 模型版本，如 6, 7。设置后忽略 --v',
    },
    {
      name: 'stylize',
      type: 'int',
      default: 100,
      help: '风格化程度 0-1000 (default: 100)',
    },
    {
      name: 'quality',
      default: '1',
      help: '生成质量 (default: 1), 可选 0.25, 0.5, 1',
    },
    {
      name: 'output',
      default: './mj-output',
      help: '下载目录 (default: ./mj-output)',
    },
    {
      name: 'wait',
      type: 'int',
      default: 180,
      help: '等待生成完成的秒数 (default: 180)',
    },
  ],
  columns: ['status', 'prompt', 'job_id', 'file', 'size'],
  func: async (page: IPage, kwargs) => {
    const prompt = kwargs.prompt as string;
    const waitSec = kwargs.wait as number;
    const outputDir = kwargs.output as string;

    // Unique run prefix to avoid overwriting
    const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const idx = Math.random().toString(36).substring(2, 6);
    const runPrefix = `${runId}_${idx}`;

    // Step 1: Navigate and check login
    await navigateToImagine(page);

    // Step 2: Build full prompt with MJ parameters
    const fullPrompt = buildMjPrompt(prompt, {
      ar: kwargs.ar as string,
      v: kwargs.v as string,
      niji: kwargs.niji as string,
      stylize: kwargs.stylize as number,
      quality: kwargs.quality as string,
    });

    // eslint-disable-next-line no-console
    console.error('[MJ imagine] Full prompt:', fullPrompt);

    // Step 3: Snapshot existing images BEFORE generating (to detect new ones later)
    const existingUrls = await snapshotImageUrls(page);

    // Step 4: Install interceptor for generate API
    await page.installInterceptor('/imagine');

    // Step 5: Fill prompt and generate
    await fillPrompt(page, fullPrompt);
    await page.wait(1);
    await clickGenerate(page);
    await page.wait(2);

    // Step 5: Extract job_id from intercepted requests
    let jobId = '';
    try {
      const intercepted: any[] = await page.getInterceptedRequests();
      for (const entry of intercepted) {
        const data = entry?.data || entry?.response || entry;
        if (data?.job_id || data?.id) {
          jobId = String(data.job_id || data.id);
          break;
        }
        // Check nested structures
        const body = data?.body || data?.result;
        if (body?.job_id || body?.id) {
          jobId = String(body.job_id || body.id);
          break;
        }
      }
    } catch { /* interceptor may not capture anything */ }

    if (jobId) {
      // eslint-disable-next-line no-console
      console.error('[MJ imagine] Captured job_id:', jobId);
    }

    // Step 6: Wait for NEW images to appear (excluding pre-existing ones)
    const imageUrls = await waitForNewImages(page, waitSec, existingUrls);

    if (imageUrls.length === 0) {
      return [{
        status: 'timeout',
        prompt: prompt.substring(0, 80),
        job_id: jobId,
        file: '',
        size: 0,
      }];
    }

    // Deduplicate URLs
    const uniqueUrls = [...new Set(imageUrls)].slice(0, 4);

    // eslint-disable-next-line no-console
    console.error('[MJ imagine] Found ' + uniqueUrls.length + ' unique image URLs');

    // Step 7: Download images via browser fetch
    mkdirSync(outputDir, { recursive: true });
    const downloaded: Array<{ file: string; size: number }> = [];

    for (let i = 0; i < uniqueUrls.length; i++) {
      const url = uniqueUrls[i];
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

      if (b64.error) {
        console.error('[MJ imagine] Download failed for URL ' + i + ':', b64.error);
        continue;
      }

      const buf = Buffer.from(b64.data.split(',')[1], 'base64');
      const ext = (b64.type || 'image/webp').split('/')[1] || 'webp';
      const fname = `${outputDir}/${runPrefix}_img_${downloaded.length + 1}.${ext}`;
      writeFileSync(fname, buf);
      downloaded.push({ file: fname, size: buf.length });
    }

    return downloaded.map((d, i) => ({
      status: 'success',
      prompt: i === 0 ? prompt.substring(0, 80) : '',
      job_id: i === 0 ? jobId : '',
      file: d.file,
      size: d.size,
    }));
  },
});
