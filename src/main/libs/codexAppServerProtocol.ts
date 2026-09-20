export type CodexRpcId = number | string;

export interface CodexRpcRequest {
  id: CodexRpcId;
  method: string;
  params?: unknown;
}

export interface CodexRpcNotification {
  method: string;
  params?: unknown;
}

export interface CodexRpcResponse {
  id: CodexRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type CodexRpcMessage = CodexRpcRequest | CodexRpcNotification | CodexRpcResponse;
