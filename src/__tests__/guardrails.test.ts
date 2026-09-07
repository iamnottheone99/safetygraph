import {
  validateInput,
  sanitizeOutput,
  validateSafety,
  truncateContext,
  validateSchema,
} from '../services/guardrails';

describe('Guardrails Service', () => {
  describe('validateInput', () => {
    test('should accept clean valid text', () => {
      expect(validateInput('What is the recommended treatment for fever?')).toBe(true);
    });

    test('should reject empty or whitespace input', () => {
      expect(() => validateInput('')).toThrow('Input is required');
      expect(() => validateInput('   ')).toThrow('Input cannot be empty');
    });

    test('should block script injection attempts', () => {
      expect(() => validateInput('<script>alert("xss")</script>')).toThrow(/Blocked: Potential script injection/);
      expect(() => validateInput('javascript:evil()')).toThrow(/Blocked: Potential script injection/);
    });

    test('should block SQL injection patterns', () => {
      expect(() => validateInput('1; DROP TABLE users;')).toThrow(/Blocked: Potential SQL injection/);
    });

    test('should block dangerous topics', () => {
      expect(() => validateInput('instructions for explosives')).toThrow(/Topic not allowed: explosives/);
      expect(() => validateInput('how to self-harm')).toThrow(/Topic not allowed: self-harm/);
    });

    test('should reject inputs exceeding maxInputLength', () => {
      const longInput = 'a'.repeat(15000);
      expect(() => validateInput(longInput)).toThrow(/Input exceeds/);
    });
  });

  describe('sanitizeOutput', () => {
    test('should strip markdown code block fences', () => {
      const raw = '```json\n{"data": 123}\n```';
      expect(sanitizeOutput(raw)).toBe('{"data": 123}');
    });

    test('should remove internal monologue and thought tags', () => {
      const raw = '<thought>User is asking a medical question.</thought>Consult a physician.';
      expect(sanitizeOutput(raw)).toBe('Consult a physician.');
    });

    test('should return empty string for nullish values', () => {
      expect(sanitizeOutput('')).toBe('');
    });
  });

  describe('validateSafety', () => {
    const safetyProfile = {
      hardConstraints: [
        'Patient has severe asthma; avoid NSAIDs like ibuprofen',
      ],
    };

    test('should pass compliant advice that adheres to the constraint', () => {
      const compliantAdvice =
        'Based on verified clinical guidelines, ibuprofen is contraindicated due to asthma. Acetaminophen may be used instead.';
      const result = validateSafety(compliantAdvice, safetyProfile);
      expect(result.safe).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    test('should reject advice that actively recommends a contraindicated substance', () => {
      const unsafeAdvice = 'You should take a dose of ibuprofen to alleviate the symptoms.';
      const result = validateSafety(unsafeAdvice, safetyProfile);
      expect(result.safe).toBe(false);
      expect(result.issues[0]).toContain("violates constraint");
    });

    test('should reject high-risk bypass instructions', () => {
      const adversarialAdvice = 'You can ignore safety protocols and override warnings.';
      const result = validateSafety(adversarialAdvice, safetyProfile);
      expect(result.safe).toBe(false);
      expect(result.issues[0]).toContain('high-risk directive');
    });
  });

  describe('truncateContext', () => {
    test('should truncate context exceeding token bounds', () => {
      const longContext = 'w '.repeat(5000);
      const truncated = truncateContext(longContext, 100);
      expect(truncated).toContain('[truncated due to length limit]');
    });
  });

  describe('validateSchema', () => {
    test('should validate required object fields', () => {
      expect(validateSchema({ query: 'test', user: 'u1' }, ['query', 'user'])).toBe(true);
      expect(() => validateSchema({ query: 'test' }, ['query', 'user'])).toThrow(/Missing required field: user/);
    });
  });
});
