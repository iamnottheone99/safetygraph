import { CircuitBreaker, CircuitState, CircuitBreakerManager } from '../utils/circuitBreaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      name: 'test-breaker',
      failureThreshold: 2,
      successThreshold: 2,
      timeout: 100, // 100ms for fast testing
    });
  });

  test('should start in CLOSED state', () => {
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  test('should successfully execute operations in CLOSED state', async () => {
    const result = await breaker.execute(async () => 'success_value');
    expect(result).toBe('success_value');
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  test('should transition to OPEN after reaching failureThreshold', async () => {
    const failingOp = async () => {
      throw new Error('Service failure');
    };

    // First failure
    await expect(breaker.execute(failingOp)).rejects.toThrow('Service failure');
    expect(breaker.getState()).toBe(CircuitState.CLOSED);

    // Second failure (hits threshold = 2)
    await expect(breaker.execute(failingOp)).rejects.toThrow('Service failure');
    expect(breaker.getState()).toBe(CircuitState.OPEN);
  });

  test('should fail fast with 503 when circuit is OPEN', async () => {
    breaker.onFailure();
    breaker.onFailure();
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    await expect(breaker.execute(async () => 'will not run')).rejects.toMatchObject({
      statusCode: 503,
      errorCode: 'E_SERVICE_UNAVAILABLE',
    });
  });

  test('should transition to HALF_OPEN after timeout and recover to CLOSED on successes', async () => {
    breaker.onFailure();
    breaker.onFailure();
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    // Wait for timeout (100ms)
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

    // First success in HALF_OPEN
    await breaker.execute(async () => 'recovery 1');
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

    // Second success in HALF_OPEN (hits successThreshold = 2) -> closes circuit
    await breaker.execute(async () => 'recovery 2');
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  test('should reset state cleanly', () => {
    breaker.onFailure();
    breaker.onFailure();
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    breaker.reset();
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    expect(breaker.getStatus().failureCount).toBe(0);
  });
});

describe('CircuitBreakerManager', () => {
  test('should manage multiple named circuit instances', () => {
    const manager = new CircuitBreakerManager();
    const b1 = manager.getBreaker('service-a');
    const b2 = manager.getBreaker('service-b');

    expect(b1.name).toBe('service-a');
    expect(b2.name).toBe('service-b');
    expect(manager.getAllStatuses()).toHaveLength(2);

    manager.resetAll();
    expect(b1.getState()).toBe(CircuitState.CLOSED);
  });
});
