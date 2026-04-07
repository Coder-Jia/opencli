/**
 * Jimeng download — download a generated video.
 */

import { cli, Strategy } from '../../registry.js';
import { writeFileSync } from 'node:fs';
import { navigateToGenerate, getRecordList } from './utils.js';
import { CommandExecutionError, SelectorError } from '../../errors.js';

cli({
  site: 'jimeng',
  name: 'download',
  description: 'Download a generated Jimeng video',
  domain: 'jimeng.jianying.com',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  timeoutSeconds: 60,
  args: [
    {
      name: 'record_id',
      positional: true,
      help: 'Record ID to download (omit for latest)',
    },
    {
      name: 'output',
      default: './jimeng-video.mp4',
      help: 'Output file path (default: ./jimeng-video.mp4)',
    },
  ],
  columns: ['status', 'file', 'size_mb'],
  func: async (page, kwargs) => {
    await navigateToGenerate(page);

    // Determine which record to download
    let targetId = kwargs.record_id;
    if (!targetId) {
      const records = await getRecordList(page);
      if (!records || records.length === 0) {
        throw new CommandExecutionError('No video records found on the page');
      }
      targetId = records[0].recordId;
    }

    // Click the target card thumbnail to activate the video player
    const clickResult = await page.evaluate(`
      (async () => {
        const target = document.querySelector('[id*=${JSON.stringify(targetId)}]');
        if (!target) return 'Record not found: ${targetId}';

        // Find the thumbnail image or clickable area
        const thumb = target.querySelector('img, video, [class*=thumbnail], [class*=cover]');
        if (thumb) thumb.click();
        else target.click();

        await new Promise(r => setTimeout(r, 1500));
        return 'ok';
      })()
    `);

    if (clickResult !== 'ok') {
      throw new SelectorError(`[id*=${targetId}]`, clickResult as string);
    }

    // Get the video URL from the active player
    const videoUrl = await page.evaluate(`
      (() => {
        const videos = document.querySelectorAll('video');
        if (videos.length === 0) return null;
        // Use the first (newest) video element
        const v = videos[0];
        return v.src || v.currentSrc;
      })()
    `);

    if (!videoUrl) {
      throw new SelectorError('video', 'No video element found after clicking thumbnail');
    }

    // Download using Node.js fetch
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new CommandExecutionError(`Failed to download video: HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    writeFileSync(kwargs.output, buffer);

    const sizeMb = (buffer.length / (1024 * 1024)).toFixed(2);

    return [{
      status: 'downloaded',
      file: kwargs.output,
      size_mb: `${sizeMb} MB`,
    }];
  },
});
