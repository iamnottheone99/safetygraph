import * as readline from 'readline';
import { mcpService, JsonRpcRequest } from '../services/mcpService';

const MAX_STDIO_LINE_LENGTH = 512 * 1024; // 512KB payload ceiling

export function startStdioServer(): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.length > MAX_STDIO_LINE_LENGTH) {
      const errorResponse = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Payload exceeds maximum line length limit (512KB)' },
      };
      process.stdout.write(JSON.stringify(errorResponse) + '\n');
      return;
    }

    try {
      const request = JSON.parse(trimmed) as JsonRpcRequest;
      const response = await mcpService.handleRequest(request);
      if (response !== null) {
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    } catch (err: any) {
      const errorResponse = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: `Parse error: ${err.message}` },
      };
      process.stdout.write(JSON.stringify(errorResponse) + '\n');
    }
  });
}

if (require.main === module) {
  startStdioServer();
}
