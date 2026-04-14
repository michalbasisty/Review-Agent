/**
 * Security guard against prompt injection attacks.
 * Detects both direct and indirect injection attempts.
 */
export function guardInjection(input: string): void {
  const patterns = [
    /ignore\s*previous/i,
    /ignore\s*all\s*previous/i,
    /system\s*prompt/i,
    /jailbreak/i,
    /override\s*(?:the\s*)?system/i,
    /reveal\s*(?:your\s*)?(?:configuration|instructions|prompt)/i,
  ];

  if (patterns.some((p) => p.test(input))) {
    throw new Error("Prompt injection detected");
  }
}
