import { A as AccumulateOptions, M as MakeSetOptions, E as ENASet } from './types-D1hkFDIv.js';

interface ENAOptions extends AccumulateOptions, MakeSetOptions {
}
declare function ena(options: ENAOptions): ENASet;

interface ENAWorkerRequest {
    id: string;
    options: ENAOptions;
}
interface ENAWorkerCancel {
    id: string;
    cancel: true;
}
interface ENAWorkerResponse {
    id: string;
    ok: boolean;
    result?: unknown;
    error?: string;
    progress?: number;
    stage?: string;
}

export { type ENAOptions as E, type ENAWorkerRequest as a, type ENAWorkerCancel as b, type ENAWorkerResponse as c, ena as e };
