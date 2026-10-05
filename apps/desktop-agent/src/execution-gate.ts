export interface ToolExecutionRequest {
  readonly executionId: string;
  readonly idempotencyKey: string;
  readonly authorizationId: string;
  readonly policyDecision: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL' | 'REQUIRE_STRONG_APPROVAL';
  readonly actionHash: string;
  readonly tool: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface ExactAuthorizationVerifier {
  verify(input: {
    readonly executionId: string;
    readonly authorizationId: string;
    readonly tool: string;
    readonly policyDecision: ToolExecutionRequest['policyDecision'];
    readonly actionHash: string;
  }): Promise<boolean>;
}

export interface DisabledByDefaultToolRunner {
  run(request: ToolExecutionRequest): Promise<Readonly<Record<string, unknown>>>;
}

export interface ExecutionResult {
  readonly status: 'COMPLETED' | 'DUPLICATE';
  readonly result: Readonly<Record<string, unknown>>;
}

interface LedgerEntry {
  readonly idempotencyKey: string;
  readonly result: Readonly<Record<string, unknown>>;
}

export class DesktopExecutionGate {
  private readonly completed = new Map<string, LedgerEntry>();
  private readonly running = new Map<string, string>();

  constructor(
    private readonly authorizations: ExactAuthorizationVerifier,
    private readonly runner: DisabledByDefaultToolRunner,
  ) {}

  async handle(request: ToolExecutionRequest): Promise<ExecutionResult> {
    const completed = this.completed.get(request.executionId);
    if (completed) {
      if (completed.idempotencyKey !== request.idempotencyKey) {
        throw new Error('Execution identifier conflict');
      }
      return { status: 'DUPLICATE', result: completed.result };
    }
    const runningKey = this.running.get(request.executionId);
    if (runningKey) {
      if (runningKey !== request.idempotencyKey) throw new Error('Execution identifier conflict');
      throw new Error('Execution already in progress');
    }
    if (
      !(await this.authorizations.verify({
        executionId: request.executionId,
        authorizationId: request.authorizationId,
        tool: request.tool,
        policyDecision: request.policyDecision,
        actionHash: request.actionHash,
      }))
    ) {
      throw new Error('Exact execution authorization required');
    }

    this.running.set(request.executionId, request.idempotencyKey);
    try {
      const result = await this.runner.run(request);
      this.completed.set(request.executionId, {
        idempotencyKey: request.idempotencyKey,
        result,
      });
      return { status: 'COMPLETED', result };
    } finally {
      this.running.delete(request.executionId);
    }
  }
}
