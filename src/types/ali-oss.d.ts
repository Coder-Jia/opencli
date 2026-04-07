declare module 'ali-oss' {
  interface OSSOptions {
    region: string;
    accessKeyId: string;
    accessKeySecret: string;
    bucket: string;
  }
  interface PutResult {
    url: string;
    name: string;
    res: { status: number };
  }
  class OSS {
    constructor(options: OSSOptions);
    put(name: string, file: string | Buffer | NodeJS.ReadableStream): Promise<PutResult>;
  }
  export default OSS;
}
