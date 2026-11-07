import pino from 'pino';
import { vectorService } from './vectorService';
import { graphContextService } from './graphContextService';
import { aiService } from './aiService';
import {
  validateInput,
  validateSafetyAsync,
  sanitizeOutput,
  extractAndVerifyCitations,
} from './guardrails';

const logger = pino();

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'safetygraph_query',
    description:
      'Execute a verified RAG query with dual-retrieval (Neo4j graph constraints + hybrid vector RRF search), citation tracing, and safety guardrails.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Clinical or domain query string' },
        entities: {
          type: 'array',
          items: { type: 'string' },
          description: 'Entities or subjects to query for active constraints (e.g. ["asthma"])',
        },
        strict_grounding: {
          type: 'boolean',
          description: 'When true, strictly enforces faithfulness verification against retrieved context',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'safetygraph_search',
    description:
      'Search indexed reference documents using hybrid pgvector dense embeddings and full-text keyword RRF fusion.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keywords or semantic query' },
        topK: { type: 'number', description: 'Number of documents to return (default 3)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'safetygraph_get_constraints',
    description:
      'Retrieve active hard constraints and contraindications for specific entities from the Knowledge Graph.',
    inputSchema: {
      type: 'object',
      properties: {
        entities: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of entities to inspect',
        },
      },
      required: ['entities'],
    },
  },
  {
    name: 'safetygraph_verify_safety',
    description:
      'Run deterministic and semantic guardrails against response advice using hard constraints and grounding context.',
    inputSchema: {
      type: 'object',
      properties: {
        response: { type: 'string', description: 'Generated text or advice to verify' },
        hardConstraints: {
          type: 'array',
          items: { type: 'string' },
          description: 'Active hard constraints that must not be violated',
        },
        prohibitedEntities: {
          type: 'array',
          items: { type: 'string' },
          description: 'Entities strictly prohibited from recommendation',
        },
      },
      required: ['response', 'hardConstraints'],
    },
  },
];

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class McpService {
  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = request.id !== undefined ? request.id : null;

    try {
      switch (request.method) {
        case 'initialize':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              serverInfo: {
                name: 'safetygraph',
                version: '1.0.0',
              },
              capabilities: {
                tools: {},
              },
            },
          };

        case 'notifications/initialized':
          // JSON-RPC notifications must not produce a response
          return null;

        case 'ping':
          return { jsonrpc: '2.0', id, result: {} };

        case 'tools/list':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              tools: MCP_TOOLS,
            },
          };

        case 'tools/call': {
          const toolName = request.params?.name;
          const args = request.params?.arguments || {};
          const result = await this.executeTool(toolName, args);

          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                },
              ],
              isError: false,
            },
          };
        }

        default:
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method not found: ${request.method}`,
            },
          };
      }
    } catch (err: any) {
      logger.warn({ err: err.message, method: request.method }, 'MCP request execution failed');
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: `Error executing tool: ${err.message}`,
            },
          ],
          isError: true,
        },
      };
    }
  }

  private async executeTool(toolName: string, args: Record<string, any>): Promise<any> {
    switch (toolName) {
      case 'safetygraph_search': {
        const topK = typeof args.topK === 'number' ? args.topK : 3;
        return await vectorService.searchSimilar(args.query || '', topK);
      }

      case 'safetygraph_get_constraints': {
        const entities = Array.isArray(args.entities) ? args.entities : [];
        return await graphContextService.getHardConstraints(entities);
      }

      case 'safetygraph_verify_safety': {
        const { response = '', hardConstraints = [], prohibitedEntities = [] } = args;
        return await validateSafetyAsync(response, {
          hardConstraints,
          prohibitedEntities,
        });
      }

      case 'safetygraph_query': {
        const { query = '', entities = [], strict_grounding = false } = args;
        validateInput(query);

        const [vectorContext, constraints] = await Promise.all([
          vectorService.searchSimilar(query, 3),
          graphContextService.getHardConstraints(entities),
        ]);

        const rawResponse = await aiService.generateResponse({
          query,
          contextData: { constraints, vectorContext },
        });

        const sanitized = sanitizeOutput(rawResponse);
        const safetyCheck = await validateSafetyAsync(sanitized, {
          hardConstraints: constraints,
          retrievedContext: vectorContext.map((v) => v.content),
          availableDocIds: vectorContext.map((v) => v.id),
          enforceFaithfulness: strict_grounding,
        });

        const citationCheck = extractAndVerifyCitations(
          sanitized,
          vectorContext.map((v) => v.id)
        );

        return {
          response: sanitized,
          constraints_applied: constraints,
          vector_sources: vectorContext.map((v) => ({ id: v.id, similarity: v.similarity })),
          citations: citationCheck.citedIds,
          citation_verification: {
            valid: citationCheck.validCitations,
            invalid: citationCheck.invalidCitations,
            grounded: citationCheck.isGrounded,
          },
          safety_verified: safetyCheck.safe,
          faithfulness: safetyCheck.faithfulness,
          verification_metadata: safetyCheck.evaluationMetadata,
          provider: aiService.getProviderInfo(),
        };
      }

      default:
        throw new Error(`Unknown MCP tool: ${toolName}`);
    }
  }
}

export const mcpService = new McpService();
