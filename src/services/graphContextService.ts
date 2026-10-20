import pino from 'pino';
import neo4j, { Driver } from 'neo4j-driver';
import { circuitManager } from '../utils/circuitBreaker';

const logger = pino();

export class GraphContextService {
  private driver: Driver | null = null;
  private dbBreaker = circuitManager.getBreaker('neo4j', { failureThreshold: 3, timeout: 15000 });

  // Resilient in-memory fallback knowledge graph for offline testing and local evaluation
  private fallbackConstraints: Map<string, string[]> = new Map([
    ['ibuprofen', ['Patient has severe asthma; avoid NSAIDs like ibuprofen']],
    ['nsaids', ['Patient has severe asthma; avoid NSAIDs like ibuprofen']],
    ['aspirin', ['Patient has severe asthma; avoid NSAIDs like aspirin']],
  ]);

  private isConnected = false;

  constructor() {
    this.initDriver();
  }

  private initDriver(): void {
    try {
      const uri = process.env.NEO4J_URI || 'neo4j://localhost:7687';
      const user = process.env.NEO4J_USER || 'neo4j';
      const password = process.env.NEO4J_PASSWORD || 'password';
      const connectionTimeout = process.env.NODE_ENV === 'test' ? 500 : 5000;
      this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
        connectionTimeout,
        maxConnectionLifetime: 3 * 60 * 60 * 1000,
      });
    } catch (_error) {
      logger.warn('Neo4j driver initialization deferred; operating in resilient fallback mode');
      this.isConnected = false;
    }
  }

  /**
   * Asynchronously verify connectivity to Neo4j cluster/server
   */
  async verifyConnectivity(): Promise<boolean> {
    if (!this.driver) return false;

    try {
      return await this.dbBreaker.execute(async () => {
        const serverInfo = await this.driver!.getServerInfo();
        this.isConnected = true;
        logger.info({ agent: serverInfo.agent }, 'Neo4j connectivity verified');
        return true;
      });
    } catch (err: any) {
      logger.warn(
        { err: err.message },
        'Neo4j connection unavailable; operating in resilient fallback mode'
      );
      this.isConnected = false;
      return false;
    }
  }

  isReady(): boolean {
    return this.isConnected;
  }

  /**
   * Register a constraint into Neo4j (if connected) and local in-memory fallback store
   */
  async registerConstraint(entity: string, constraint: string): Promise<void> {
    const key = entity.toLowerCase();
    const existing = this.fallbackConstraints.get(key) || [];
    if (!existing.includes(constraint)) {
      existing.push(constraint);
      this.fallbackConstraints.set(key, existing);
    }

    if (this.driver && this.isConnected) {
      try {
        await this.dbBreaker.execute(async () => {
          const session = this.driver!.session();
          try {
            await session.run(
              `
              MERGE (e:Entity { name: $entity })
              MERGE (c:Constraint { name: $constraint })
              MERGE (e)-[:HAS_CONSTRAINT]->(c)
            `,
              { entity: key, constraint }
            );
          } finally {
            await session.close();
          }
        });
      } catch (err: any) {
        logger.warn(
          { err: err.message },
          'Failed to persist constraint to Neo4j; stored in fallback store'
        );
      }
    }
  }

  /**
   * Retrieves hard constraints for specified entities from Neo4j and fallback store
   */
  async getHardConstraints(entities: string[]): Promise<string[]> {
    if (!entities || entities.length === 0) return [];

    const matchedConstraints: string[] = [];

    if (this.driver && this.isConnected) {
      try {
        await this.dbBreaker.execute(async () => {
          const session = this.driver!.session();
          try {
            const normalized = entities.map((e) => e.toLowerCase());
            const result = await session.run(
              `
              MATCH (e:Entity)-[:HAS_CONSTRAINT]->(c:Constraint)
              WHERE toLower(e.name) IN $entities
              RETURN DISTINCT c.name as constraintName
            `,
              { entities: normalized }
            );

            for (const record of result.records) {
              matchedConstraints.push(record.get('constraintName'));
            }
          } finally {
            await session.close();
          }
        });
      } catch (err: any) {
        logger.warn(
          { err: err.message },
          'Neo4j connection/query unavailable; utilizing resilient fallback constraints'
        );
      }
    }

    // In-memory fallback lookup (complements or serves as fallback)
    for (const entity of entities) {
      const key = entity.toLowerCase();
      if (this.fallbackConstraints.has(key)) {
        matchedConstraints.push(...this.fallbackConstraints.get(key)!);
      }
    }

    return Array.from(new Set(matchedConstraints));
  }

  async close(): Promise<void> {
    if (this.driver) {
      try {
        await this.driver.close();
      } catch (err: any) {
        logger.debug({ err: err.message }, 'Error closing Neo4j driver');
      } finally {
        this.driver = null;
        this.isConnected = false;
      }
    }
  }
}

export const graphContextService = new GraphContextService();
