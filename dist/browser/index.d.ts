import { E as ENAOptions, a as ENAWorkerRequest, b as ENAWorkerCancel, c as ENAWorkerResponse } from '../worker-DbeQhbrj.js';
import { E as ENASet } from '../types-D1hkFDIv.js';

interface ENAWorkerProgress {
    id: string;
    progress: number;
    stage?: string;
}
interface ENAWorkerLike {
    postMessage(message: ENAWorkerRequest | ENAWorkerCancel): void;
    addEventListener(type: 'message', listener: (event: MessageEvent<ENAWorkerResponse>) => void): void;
    removeEventListener(type: 'message', listener: (event: MessageEvent<ENAWorkerResponse>) => void): void;
    terminate?: () => void;
}
interface ENAWorkerRunHandle {
    id: string;
    promise: Promise<ENASet>;
    cancel(): void;
}
interface ENAWorkerClient {
    run(options: ENAOptions, onProgress?: (progress: ENAWorkerProgress) => void): Promise<ENASet>;
    start(options: ENAOptions, onProgress?: (progress: ENAWorkerProgress) => void): ENAWorkerRunHandle;
    cancel(id: string): void;
    terminate(): void;
}
declare function createENAWorkerClient(worker: ENAWorkerLike): ENAWorkerClient;

export { type ENAWorkerClient, type ENAWorkerLike, type ENAWorkerProgress, type ENAWorkerRunHandle, createENAWorkerClient };
