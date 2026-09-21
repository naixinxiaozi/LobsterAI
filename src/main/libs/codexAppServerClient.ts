import { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';

import type {
  CodexRpcId,
  CodexRpcMessage,
} from './codexAppServerProtocol';

export interface CodexTransport {
  input: Writable;
  output: Readable;
  close(): void;
}

interface PendingRequest {
  reject: (error: Error) => void;
  resolve: (value: unknown) => void;
}

export interface CodexAppServerClientEvents {
  close: [];
  protocolError: [Error];
  notification: [{ method: string; params?: unknown }];
  serverRequest: [{ id: CodexRpcId; method: string; params?: unknown }];
}

export interface CodexInitializeParams {
  clientInfo: {
    name: string;
    version: string;
  };
  capabilities: {
    experimentalApi?: boolean;
  };
}

export class CodexAppServerClient extends EventEmitter {
  private nextId = 1;
  private buffer = '';
  private closed = false;
  private readonly pending = new Map<CodexRpcId, PendingRequest>();

  constructor(private readonly transport: CodexTransport) {
    super();
    transport.output.setEncoding('utf8');
    transport.output.on('data', (chunk: string) => this.handleData(chunk));
    transport.output.on('error', () => this.handleClose());
    transport.output.on('close', () => this.handleClose());
    transport.output.on('end', () => this.handleClose());
    transport.input.on('error', () => this.handleClose());
    transport.input.on('close', () => this.handleClose());
  }

  request<T>(method: string, params?: unknown): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error('Codex app-server transport closed'));
    }

    const id = this.nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });
    this.write({ id, method, ...(params === undefined ? {} : { params }) });
    return promise;
  }

  async initialize(params: CodexInitializeParams): Promise<void> {
    await this.request('initialize', params);
    this.notify('initialized');
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) {
      throw new Error('Codex app-server transport closed');
    }
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  respond(id: CodexRpcId, result: unknown): void {
    if (this.closed) {
      throw new Error('Codex app-server transport closed');
    }
    this.write({ id, result });
  }

  respondError(id: CodexRpcId, code: number, message: string, data?: unknown): void {
    if (this.closed) {
      throw new Error('Codex app-server transport closed');
    }
    this.write({ id, error: { code, message, ...(data === undefined ? {} : { data }) } });
  }

  close(): void {
    if (!this.closed) {
      this.handleClose();
      this.transport.close();
    }
  }

  override emit<K extends keyof CodexAppServerClientEvents>(
    event: K,
    ...args: CodexAppServerClientEvents[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof CodexAppServerClientEvents>(
    event: K,
    listener: (...args: CodexAppServerClientEvents[K]) => void,
  ): this {
    return super.on(event, listener);
  }

  private write(message: CodexRpcMessage): void {
    this.transport.input.write(`${JSON.stringify(message)}\n`);
  }

  private handleData(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) {
        try {
          this.handleMessage(JSON.parse(line) as CodexRpcMessage);
        } catch {
          this.handleProtocolError(new Error('Invalid Codex app-server JSONL'));
          return;
        }
      }
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private handleMessage(message: CodexRpcMessage): void {
    if ('method' in message) {
      if ('id' in message) {
        this.emit('serverRequest', message);
      } else {
        this.emit('notification', message);
      }
      return;
    }

    const request = this.pending.get(message.id);
    if (!request) {
      return;
    }
    this.pending.delete(message.id);
    if (message.error) {
      request.reject(new Error(`${message.error.code}: ${message.error.message}`));
    } else {
      request.resolve(message.result);
    }
  }

  private handleClose(error = new Error('Codex app-server transport closed')): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const request of this.pending.values()) {
      request.reject(error);
    }
    this.pending.clear();
    this.emit('close');
  }

  private handleProtocolError(error: Error): void {
    if (this.closed) return;
    this.emit('protocolError', error);
    this.handleClose(error);
    this.transport.close();
  }
}
