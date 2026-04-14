/**
 * Retry logic with exponential backoff.
 * Does NOT retry non-retryable errors (token limits, auth failures).
 */
const NON_RETRYABLE_PATTERNS = [
  /rate_limit_exceeded/,
  /token.*limit/i,
  /Request too large/i,
  /401/i,
  /403/i,
  /credit balance/i,
];

function isRetryable(error: any): boolean {
  const message = String(error.message || error);
  return !NON_RETRYABLE_PATTERNS.some((p) => p.test(message));
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      if (!isRetryable(error)) {
        console.error(`[Retry] Non-retryable error: ${error.message}`);
        throw error;
      }

      const isLastAttempt = attempt === maxRetries - 1;
      if (isLastAttempt) throw error;

      const delay = baseDelay * Math.pow(2, attempt);
      console.error(
        `[Retry] Attempt ${attempt + 1} failed: ${error.message}. Retrying in ${delay}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Retry logic error"); // Should never reach
}
