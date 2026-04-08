import { cli, Strategy } from '../../src/registry.js';
import { CliError } from '../../src/errors.js';
import { submitTask, pollTask } from './utils.js';
cli({
    site: 'runninghub',
    name: 'generate',
    description: 'Generate video using Wanxiang 2.6 Reference-to-Video Flash (参考生视频)',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'prompt', positional: true, required: true, help: 'Text prompt for video generation' },
        { name: 'images', type: 'string', help: 'Comma-separated reference image URLs (max 5)' },
        { name: 'videos', type: 'string', help: 'Comma-separated reference video URLs (max 5)' },
        {
            name: 'size',
            type: 'string',
            default: '1920*1080',
            choices: [
                '720*1280', '1280*720', '832*1088', '1088*832',
                '960*960', '1440*1440', '1080*1920', '1920*1080',
                '1248*1632', '1632*1248',
            ],
            help: 'Output resolution (default: 1920*1080)',
        },
        { name: 'duration', type: 'string', default: '5', help: 'Video duration in seconds (2-10)' },
        {
            name: 'shotType',
            type: 'string',
            default: 'single',
            choices: ['single', 'multi'],
            help: 'Shot type: single (单镜头) or multi (多镜头)',
        },
        { name: 'audio', type: 'boolean', default: false, help: 'Generate audio for the video' },
    ],
    columns: ['taskId', 'status', 'url'],
    timeoutSeconds: 600,
    requiredEnv: [{ name: 'RUNNINGHUB_API_KEY', help: 'Get your API key from https://www.runninghub.cn' }],
    func: async (_page, args, debug) => {
        const imageUrls = args.images ? String(args.images).split(',').map((s) => s.trim()).filter(Boolean) : [];
        const videoUrls = args.videos ? String(args.videos).split(',').map((s) => s.trim()).filter(Boolean) : [];
        if (imageUrls.length + videoUrls.length === 0) {
            throw new CliError('MISSING_INPUT', 'At least one reference image or video URL is required', 'Use --images or --videos to provide reference URLs');
        }
        if (imageUrls.length > 5 || videoUrls.length > 5) {
            throw new CliError('INVALID_INPUT', 'Maximum 5 image URLs and 5 video URLs allowed', 'Reduce the number of reference URLs');
        }
        const durationNum = Number(args.duration);
        if (Number.isNaN(durationNum) || durationNum < 2 || durationNum > 10) {
            throw new CliError('INVALID_INPUT', 'Duration must be between 2 and 10 seconds', 'Use --duration with a value from 2 to 10');
        }
        const submitResult = await submitTask({
            prompt: args.prompt,
            imageUrls,
            videoUrls,
            size: args.size,
            duration: String(Math.round(durationNum)),
            shotType: args.shotType,
            audio: Boolean(args.audio),
        });
        if (!submitResult.taskId) {
            throw new CliError('SUBMIT_FAILED', `Failed to submit task: ${submitResult.errorMessage ?? 'Unknown error'}`, 'Check your parameters and API key');
        }
        if (debug) {
            // eslint-disable-next-line no-console
            console.error(`[runninghub] Task submitted: ${submitResult.taskId}`);
        }
        const result = await pollTask(submitResult.taskId, debug);
        if (result.status === 'FAILED') {
            throw new CliError('TASK_FAILED', `Task ${result.taskId} failed: ${result.errorMessage ?? 'Unknown error'}`, 'Check your prompt and reference media');
        }
        const urls = result.results?.map((r) => r.url).filter(Boolean) ?? [];
        return [{
                taskId: result.taskId,
                status: result.status,
                url: urls.join(', ') || '(no output)',
            }];
    },
});
