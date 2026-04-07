/**
 * Jimeng video — submit a video generation task on Jimeng (即梦).
 *
 * Configures model, reference mode, aspect ratio, duration, and prompt,
 * then submits the task on jimeng.jianying.com.
 *
 * Note: The existing `jimeng generate` command does text-to-image.
 * This command does text-to-video via the Seedance 2.0 pipeline.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  navigateToGenerate,
  selectComboboxOption,
  selectRatio,
  fillPrompt,
  clickSubmit,
  readProgress,
  readComboboxes,
  resolveModelName,
} from './utils.js';

cli({
  site: 'jimeng',
  name: 'video',
  description: 'Submit a video generation task on Jimeng (即梦 Seedance)',
  domain: 'jimeng.jianying.com',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  timeoutSeconds: 120,
  args: [
    {
      name: 'prompt',
      required: true,
      positional: true,
      help: 'Video generation prompt text',
    },
    {
      name: 'model',
      default: 'seedance2',
      choices: ['seedance2', 'seedance2-fast', 'seedance2-vip', 'seedance2-fast-vip', 'video3-fast'],
      help: 'Model to use (default: seedance2)',
    },
    {
      name: 'mode',
      default: '全能参考',
      choices: ['全能参考', '首尾帧', '智能多帧', '主体参考'],
      help: 'Reference mode (default: 全能参考)',
    },
    {
      name: 'ratio',
      default: '16:9',
      choices: ['16:9', '4:3', '3:4'],
      help: 'Aspect ratio (default: 16:9)',
    },
    {
      name: 'duration',
      type: 'int',
      default: 5,
      choices: ['5', '10', '15'],
      help: 'Video duration in seconds (default: 5)',
    },
  ],
  columns: ['status', 'model', 'mode', 'ratio', 'duration'],
  func: async (page, kwargs) => {
    await navigateToGenerate(page);

    // Combobox indices: 0=视频生成, 1=model, 2=mode, 3=duration

    // Step 1: Select reference mode first (resets model, so do it before model selection)
    const currentCombos = await readComboboxes(page);
    if (!(currentCombos[2] ?? '').includes(kwargs.mode)) {
      await selectComboboxOption(page, 2, kwargs.mode);
    }

    // Step 2: Select model (must re-select after mode change resets it to Fast)
    const modelDisplay = resolveModelName(kwargs.model);
    const afterMode = await readComboboxes(page);
    const currentModel = (afterMode[1] ?? '').trim();
    if (currentModel !== modelDisplay) {
      await selectComboboxOption(page, 1, modelDisplay);
    }

    // Step 3: Set aspect ratio
    await selectRatio(page, kwargs.ratio);

    // Step 4: Set duration
    const durationLabel = `${kwargs.duration}s`;
    const afterRatio = await readComboboxes(page);
    if (!(afterRatio[3] ?? '').includes(durationLabel)) {
      await selectComboboxOption(page, 3, durationLabel);
    }

    // Step 5: Fill prompt (last, to avoid mode switch overwriting it)
    await fillPrompt(page, kwargs.prompt);

    // Step 6: Submit
    await clickSubmit(page);

    // Step 7: Wait briefly and check if task was accepted
    await page.wait(2);
    const progress = await readProgress(page);

    return [{
      status: progress ? progress : 'submitted',
      model: modelDisplay,
      mode: kwargs.mode,
      ratio: kwargs.ratio,
      duration: `${kwargs.duration}s`,
    }];
  },
});
