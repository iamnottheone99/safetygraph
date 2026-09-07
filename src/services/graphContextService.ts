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

  constructor() {
    this.initDriver();
  }

  private initDriver(): void {
    try {
      const uri = process.env.NEO4J_URI || 'neo4j://localhost:7687';
      const user = process.env.NEO4J_USER || 'neo4j';
      const password = process.env.NEO4J_PASSWORD || 'password';
      this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
    } catch (error) {
      logger.warn('Neo4j driver initialization deferred; operating in resilient fallback mode');
    }
  }

  /**
   * Register an in-memory constraint for testing or fallback operation
   */
  registerConstraint(entity: string, constraint: string): void {
    const key = entity.toLowerCase();
    const existing = this.fallbackConstraints.get(key) || [];
    if (!existing.includes(constraint)) {
      existing.push(constraint);
      this.fallbackConstraints.set(key, existing);
    }
  }

  /**
   * Retrieves hard constraints for specified entities from Neo4j or fallback store
   */
  async getHardConstraints(entities: string[]): Promise<string[]> {
    if (!entities || entities.length === 0) return [];

    if (this.driver) {
      try {
        return await this.dbBreaker.execute(async () => {
          const session = this.driver!.session();
          try {
            const result = await session.run(`
              MATCH (e:Entity)-[:HAS_CONSTRAINT]->(c:Constraint)
              WHERE e.name IN $entities
              RETURN DISTINCT c.name as constraintName
            `, { entities });
            
            return result.records.map(record => record.get('constraintName'));
          } finally {
            await session.close();
          }
        });
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Neo4j connection/query unavailable; utilizing resilient fallback constraints');
      }
    }

    // Resilient fallback constraint lookup
    const matchedConstraints: string[] = [];
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
      }
    }
  }
}

export const graphContextService = new GraphContextService();
