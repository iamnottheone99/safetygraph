import { mcpService, MCP_TOOLS } from '../services/mcpService';
import Fastify, { FastifyInstance } from 'fastify';
import ragRoutes from '../routes/ragRoutes';

describe('Model Context Protocol (MCP) Interface', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(ragRoutes, { prefix: '/api/v1/rag' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('McpService Core Protocol', () => {
    test('should respond to initialize handshake', async () => {
      const response = await mcpService.handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      });

      expect(response!.jsonrpc).toBe('2.0');
      expect(response!.id).toBe(1);
      expect(response!.result).toBeDefined();
      expect(response!.result.serverInfo.name).toBe('safetygraph');
      expect(response!.result.capabilities.tools).toBeDefined();
    });

    test('should list registered safetygraph tools', async () => {
      const response = await mcpService.handleRequest({
        jsonrpc: '2.0',
        id: 'req-list',
        method: 'tools/list',
      });

      expect(response!.result.tools).toHaveLength(MCP_TOOLS.length);
      const toolNames = response!.result.tools.map((t: any) => t.name);
      expect(toolNames).toContain('safetygraph_query');
      expect(toolNames).toContain('safetygraph_search');
      expect(toolNames).toContain('safetygraph_get_constraints');
      expect(toolNames).toContain('safetygraph_verify_safety');
    });

    test('should execute safetygraph_search via tools/call', async () => {
      const response = await mcpService.handleRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'safetygraph_search',
          arguments: { query: 'respiratory and asthma analgesics', topK: 2 },
        },
      });

      expect(response!.result.isError).toBe(false);
      expect(response!.result.content[0].type).toBe('text');
      const parsed = JSON.parse(response!.result.content[0].text);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
      expect(parsed[0]).toHaveProperty('similarity');
    });

    test('should execute safetygraph_get_constraints via tools/call', async () => {
      const response = await mcpService.handleRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'safetygraph_get_constraints',
          arguments: { entities: ['asthma'] },
        },
      });

      expect(response!.result.isError).toBe(false);
      const constraints = JSON.parse(response!.result.content[0].text);
      expect(Array.isArray(constraints)).toBe(true);
    });

    test('should execute safetygraph_query via tools/call', async () => {
      const response = await mcpService.handleRequest({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'safetygraph_query',
          arguments: {
            query: 'What analgesic is safe for pain in reactive airway disease?',
            entities: ['asthma'],
          },
        },
      });

      expect(response!.result.isError).toBe(false);
      const result = JSON.parse(response!.result.content[0].text);
      expect(result.safety_verified).toBe(true);
      expect(result).toHaveProperty('response');
      expect(result).toHaveProperty('citations');
      expect(result).toHaveProperty('citation_verification');
    });

    test('should return standard JSON-RPC error for unknown method', async () => {
      const response = await mcpService.handleRequest({
        jsonrpc: '2.0',
        id: 99,
        method: 'invalid_method',
      });

      expect(response!.error).toBeDefined();
      expect(response!.error?.code).toBe(-32601);
    });
  });

  describe('POST /api/v1/rag/mcp Endpoint', () => {
    test('should reject invalid non-JSON-RPC requests with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rag/mcp',
        payload: { invalid: true },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe(-32600);
    });

    test('should handle tools/list request over HTTP', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rag/mcp',
        payload: {
          jsonrpc: '2.0',
          id: 'http-1',
          method: 'tools/list',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('http-1');
      expect(body.result.tools.length).toBeGreaterThanOrEqual(4);
    });
  });
});
