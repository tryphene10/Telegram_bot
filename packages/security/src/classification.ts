export const DATA_CLASSIFICATIONS = ['PUBLIC', 'CLOUD_SAFE', 'LOCAL_ONLY', 'SECRET'] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

export const CONTENT_KINDS = [
  'PUBLIC_DOCUMENTATION',
  'USER_INSTRUCTION',
  'CODE',
  'DIFF',
  'FILE_CONTENT',
  'TERMINAL_LOG',
  'SCREENSHOT',
  'PROJECT_MEMORY',
  'TOOL_OUTPUT',
  'SECRET_VALUE',
] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

export interface ClassifiedContent {
  readonly kind: ContentKind;
  readonly classification: DataClassification;
  readonly content: string;
}

const mandatoryClassifications: Readonly<Record<ContentKind, DataClassification>> = {
  PUBLIC_DOCUMENTATION: 'PUBLIC',
  USER_INSTRUCTION: 'LOCAL_ONLY',
  CODE: 'LOCAL_ONLY',
  DIFF: 'LOCAL_ONLY',
  FILE_CONTENT: 'LOCAL_ONLY',
  TERMINAL_LOG: 'LOCAL_ONLY',
  SCREENSHOT: 'LOCAL_ONLY',
  PROJECT_MEMORY: 'LOCAL_ONLY',
  TOOL_OUTPUT: 'LOCAL_ONLY',
  SECRET_VALUE: 'SECRET',
};

export function classifyContent(kind: ContentKind, content: string): ClassifiedContent {
  return { kind, classification: mandatoryClassifications[kind], content };
}

export function markCloudSafeUserInstruction(content: string): ClassifiedContent {
  return { kind: 'USER_INSTRUCTION', classification: 'CLOUD_SAFE', content };
}
