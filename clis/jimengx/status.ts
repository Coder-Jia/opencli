/**
 * Jimeng status — check current video generation progress.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { navigateToGenerate, readProgress } from './utils.js';

cli({
  site: 'jimengx',
  name: 'status',
  description: 'Check Jimeng video generation progress',
  domain: 'jimeng.jianying.com',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  timeoutSeconds: 15,
  args: [],
  columns: ['status', 'progress'],
  func: async (page) => {
    await navigateToGenerate(page);

    const progress = await readProgress(page);

    // Check for completion indicator ("再次生成" button)
    const hasRetryBtn = await page.evaluate(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.some(b => b.textContent.includes('再次生成'));
      })()
    `);

    let status: string;
    if (progress) {
      if (progress.includes('失败') || progress.includes('错误')) {
        status = 'failed';
      } else {
        status = 'generating';
      }
    } else if (hasRetryBtn) {
      status = 'completed';
    } else {
      status = 'no_active_task';
    }

    return [{
      status,
      progress: progress ?? (status === 'completed' ? '100%' : 'N/A'),
    }];
  },
});
