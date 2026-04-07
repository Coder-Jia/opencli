/**
 * Jimeng delete — delete a specific video generation record.
 */

import { cli, Strategy } from '../../registry.js';
import { navigateToGenerate } from './utils.js';
import { CommandExecutionError, SelectorError } from '../../errors.js';

cli({
  site: 'jimeng',
  name: 'delete',
  description: 'Delete a Jimeng video generation record',
  domain: 'jimeng.jianying.com',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  timeoutSeconds: 30,
  args: [
    {
      name: 'record_id',
      required: true,
      positional: true,
      help: 'Record ID to delete',
    },
  ],
  columns: ['status', 'record_id'],
  func: async (page, kwargs) => {
    await navigateToGenerate(page);

    const recordId = kwargs.record_id;

    // Step 1: Locate the record and click its "more" menu button
    const step1 = await page.evaluate(`
      (async () => {
        const target = document.querySelector('[id*=${JSON.stringify(recordId)}]');
        if (!target) return 'NOT_FOUND';

        const opBtn = target.querySelector('[class*=operation-button], [class*=more-button], [class*=menu-button]');
        if (!opBtn) {
          // Try hover to reveal the button
          target.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
          await new Promise(r => setTimeout(r, 500));
          const opBtn2 = target.querySelector('[class*=operation-button], [class*=more-button], [class*=menu-button]');
          if (!opBtn2) return 'NO_MENU_BTN';
          opBtn2.click();
        } else {
          opBtn.click();
        }

        await new Promise(r => setTimeout(r, 800));
        return 'OK';
      })()
    `);

    if (step1 === 'NOT_FOUND') {
      throw new SelectorError(`[id*=${recordId}]`, `Record ${recordId} not found`);
    }
    if (step1 === 'NO_MENU_BTN') {
      throw new SelectorError('operation-button', 'Could not find the menu button for this record');
    }

    // Step 2: Click "删除" in the dropdown menu
    const step2 = await page.evaluate(`
      (async () => {
        const items = document.querySelectorAll('[role=menuitem], [class*=dropdown-item], [class*=menu-item]');
        let deleteBtn = null;
        for (const item of items) {
          if (item.textContent.includes('删除')) {
            deleteBtn = item;
            break;
          }
        }
        if (!deleteBtn) return 'NO_DELETE_OPTION';
        deleteBtn.click();
        await new Promise(r => setTimeout(r, 800));
        return 'OK';
      })()
    `);

    if (step2 === 'NO_DELETE_OPTION') {
      throw new SelectorError('delete menu item', 'Delete option not found in dropdown');
    }

    // Step 3: Click confirm in the confirmation dialog
    const step3 = await page.evaluate(`
      (async () => {
        // Look for a "删除" or "确认" button in the confirmation modal
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          const text = btn.textContent.trim();
          if (text === '删除' || text === '确认删除' || text === '确认') {
            // Make sure it's in a modal/dialog
            const inDialog = btn.closest('[role=dialog], [class*=modal], [class*=dialog], [class*=popup]');
            if (inDialog) {
              btn.click();
              await new Promise(r => setTimeout(r, 500));
              return 'OK';
            }
          }
        }

        // Fallback: click any danger/primary button that appeared
        const dangerBtn = document.querySelector('button[class*=danger], button[class*=primary]');
        if (dangerBtn && dangerBtn.textContent.includes('删')) {
          dangerBtn.click();
          await new Promise(r => setTimeout(r, 500));
          return 'OK';
        }

        return 'NO_CONFIRM';
      })()
    `);

    if (step3 === 'NO_CONFIRM') {
      throw new CommandExecutionError('Delete confirmation dialog did not appear or could not be found');
    }

    // Step 4: Verify deletion
    await page.wait(1);
    const stillExists = await page.evaluate(`
      (() => !!document.querySelector('[id*=${JSON.stringify(recordId)}]'))()
    `);

    return [{
      status: stillExists ? 'delete_submitted' : 'deleted',
      record_id: recordId,
    }];
  },
});
