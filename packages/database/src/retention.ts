export const DEFAULT_RETENTION = Object.freeze({
  terminalLogsDays: 30,
  screenshotsDays: 7,
  temporaryFilesHours: 24,
});

export interface RetentionPolicy {
  readonly terminalLogsDays: number;
  readonly screenshotsDays: number;
  readonly temporaryFilesHours: number;
}

export function validateRetentionPolicy(policy: RetentionPolicy): RetentionPolicy {
  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`${name} must be a positive integer`);
    }
  }
  return Object.freeze({ ...policy });
}
