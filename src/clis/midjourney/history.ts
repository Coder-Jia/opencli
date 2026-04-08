/**
 * MidJourney history — list recent generation records.
 *
 * Strategy:
 * 1. Navigate to midjourney.com/imagine
 * 2. Try MJ internal API (/api/jobs) to get job list
 * 3. Fallback to DOM scraping if API fails
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { navigateToImagine, getHistoryList } from './utils.js';

cli({
  site: 'midjourney',
  name: 'history',
  description: 'MidJourney 查看最近生成的图片',
  domain: 'www.midjourney.com',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  timeoutSeconds: 30,
  args: [
    {
      name: 'limit',
      type: 'int',
      default: 10,
      help: '最大显示数量 (default: 10)',
    },
  ],
  columns: ['index', 'job_id', 'prompt', 'status', 'thumbnail'],
  func: async (page, kwargs) => {
    await navigateToImagine(page);

    const records = await getHistoryList(page, kwargs.limit as number);

    return records.slice(0, kwargs.limit as number).map((r, i) => ({
      index: i + 1,
      job_id: r.job_id,
      prompt: r.prompt,
      status: r.status,
      created_at: r.created_at,
      thumbnail: r.thumbnail,
    }));
  },
});
