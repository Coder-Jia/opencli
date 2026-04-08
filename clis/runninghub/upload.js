import { cli, Strategy } from '../../src/registry.js';
import { CliError } from '../../src/errors.js';
import OSS from 'ali-oss';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
cli({
    site: 'runninghub',
    name: 'upload',
    description: 'Upload local images/videos to Alibaba Cloud OSS and return public URLs',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'files', positional: true, required: true, help: 'Local file path(s), comma-separated for multiple' },
        { name: 'prefix', type: 'string', default: 'opencli-media', help: 'OSS remote directory prefix' },
    ],
    columns: ['file', 'url'],
    requiredEnv: [
        { name: 'ALIBABA_CLOUD_ACCESS_KEY_ID', help: 'Alibaba Cloud AccessKey ID' },
        { name: 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', help: 'Alibaba Cloud AccessKey Secret' },
        { name: 'OSS_BUCKET', help: 'OSS bucket name' },
        { name: 'OSS_REGION', help: 'OSS region, e.g. oss-cn-beijing' },
    ],
    func: async (_page, args, debug) => {
        const { accessKeyId, accessKeySecret, bucket, region } = getOssConfig();
        const filePaths = String(args.files)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        if (filePaths.length === 0) {
            throw new CliError('MISSING_INPUT', 'No files specified', 'Provide one or more file paths separated by commas');
        }
        const client = new OSS({ region, accessKeyId, accessKeySecret, bucket });
        const results = await Promise.all(filePaths.map(async (localPath) => {
            if (!fs.existsSync(localPath)) {
                throw new CliError('FILE_NOT_FOUND', `File not found: ${localPath}`, 'Check the file path');
            }
            const ext = path.extname(localPath);
            const hash = crypto.randomBytes(8).toString('hex');
            const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const fileName = `${dateStr}_${hash}${ext}`;
            const remotePath = `${args.prefix}/${fileName}`;
            const fileSizeMB = (fs.statSync(localPath).size / (1024 * 1024)).toFixed(2);
            if (debug) {
                // eslint-disable-next-line no-console
                console.error(`[oss] Uploading ${localPath} (${fileSizeMB} MB) -> ${remotePath}`);
            }
            const result = await client.put(remotePath, localPath);
            return { file: localPath, url: result.url };
        }));
        return results;
    },
});
function getOssConfig() {
    const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
    const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
    const bucket = process.env.OSS_BUCKET;
    const region = process.env.OSS_REGION;
    const missing = [];
    if (!accessKeyId)
        missing.push('ALIBABA_CLOUD_ACCESS_KEY_ID');
    if (!accessKeySecret)
        missing.push('ALIBABA_CLOUD_ACCESS_KEY_SECRET');
    if (!bucket)
        missing.push('OSS_BUCKET');
    if (!region)
        missing.push('OSS_REGION');
    if (missing.length > 0) {
        throw new CliError('AUTH_ERROR', `Missing environment variables: ${missing.join(', ')}`, 'Set the required OSS environment variables');
    }
    return { accessKeyId: accessKeyId, accessKeySecret: accessKeySecret, bucket: bucket, region: region };
}
