/**
 * Jimeng list — list all video generation records.
 */

import { cli, Strategy } from '../../registry.js';
import { navigateToGenerate, getRecordList } from './utils.js';

cli({
  site: 'jimeng',
  name: 'list',
  description: 'List Jimeng video generation records',
  domain: 'jimeng.jianying.com',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Max number of records to show' },
  ],
  columns: ['index', 'record_id', 'preview'],
  func: async (page, kwargs) => {
    await navigateToGenerate(page);

    const records = await getRecordList(page);
    return records.slice(0, kwargs.limit).map((r: any, i: number) => ({
      index: i + 1,
      record_id: r.recordId,
      preview: r.preview,
    }));
  },
});
