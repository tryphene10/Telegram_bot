import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, win32 } from 'node:path';
import { validateAgentProposal, validateMissionPlan, type MissionStepPlan } from '@arcc/agents';
import { createAiRuntime, type AiGateway, type ModelChoice, type ModelDefinition } from '@arcc/ai';
import { MissionRuntimeRepository, SqlModelRunAuditSink } from '@arcc/database';
import { PolicyEngine, type ActionCategory, type PolicyInput } from '@arcc/policies';
import {
  AllowlistedJsonHttpTransport,
  FileVaultStore,
  LocalSecretVault,
  SecretRedactor,
  SecretNotFoundError,
  WindowsDpapiKeyProtector,
} from '@arcc/security';
import {
  LocalFileTools,
  ToolRegistry,
  collectSafeSystemInfo,
  compileTerminalProfile,
  listSafeWindowsProcesses,
  objectSchema,
  validateProjectManifest,
  type ProjectManifest,
  type ToolAuthorization,
  type ToolRisk,
} from '@arcc/tools';
import { Pool } from 'pg';
import { ControlledBrowserService } from './browser-service.js';
import { registerControlledBrowserTools } from './browser-toolset.js';
import { ComputerUseCore, UiLeaseManager } from './computer-use-core.js';
import { registerComputerUseTools } from './computer-use-toolset.js';
import { registerDevelopmentTools } from './development-toolset.js';
import { ControlledDockerService, type DockerProjectScope } from './docker-service.js';
import { SecureExactCommandExecutor } from './exact-command-executor.js';
import { FileEmergencyStopLatch } from './file-emergency-stop.js';
import { ControlledGitService } from './git-service.js';
import {
  ManagedApplicationCatalog,
  WindowsProcessIdentityProvider,
  type ManagedApplicationDefinition,
} from './managed-application-catalog.js';
import { PlaywrightChromeDriver } from './playwright-browser-driver.js';
import { registerSecureTerminalTools } from './terminal-toolset.js';
import { SecureTerminalRunner, WindowsProcessController } from './terminal-runner.js';
import { WindowsDesktopDriver } from './windows-desktop-driver.js';

interface RuntimeConfiguration {
  readonly localModel: string;
  readonly cloudModels: readonly string[];
}

interface AdvancedManifest extends Record<string, unknown> {
  readonly git?: Readonly<{ enabled?: boolean; executablePath?: string }>;
  readonly docker?: Readonly<DockerProjectScope & { executablePath?: string }>;
  readonly browser?: Readonly<{
    executablePath?: string;
    allowedDomains?: readonly string[];
    headless?: boolean;
  }>;
  readonly computerUse?: Readonly<{
    applications?: readonly Readonly<{
      appKey?: string;
      executablePath?: string;
      executableSha256?: string;
      windowTitles?: readonly string[];
      windowTitlePrefixes?: readonly string[];
    }>[];
  }>;
}

function advanced(value: unknown): AdvancedManifest | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as AdvancedManifest)
    : undefined;
}

function windowsExecutable(value: unknown, expected: readonly string[]): string | undefined {
  if (typeof value !== 'string' || !isAbsolute(value) || !existsSync(value)) return undefined;
  return expected.includes(win32.basename(value).toLowerCase()) ? value : undefined;
}

function validStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0);
}

export interface MissionRow {
  readonly id: string;
  readonly public_id: string;
  readonly status: string;
  readonly normalized_goal: string;
  readonly context: Record<string, unknown>;
  readonly success_criteria: string[];
  readonly definition_of_done: string[];
  readonly data_classification: PolicyInput['classification'];
  readonly requested_provider: string | null;
  readonly requested_model: string | null;
  readonly plan: unknown;
  readonly version: number;
  readonly user_id: string;
  readonly user_public_id: string;
  readonly user_status: PolicyInput['userStatus'];
  readonly project_id: string;
  readonly project_public_id: string;
  readonly project_status: PolicyInput['projectStatus'];
  readonly root_path: string;
  readonly manifest: unknown;
  readonly machine_id: string;
  readonly machine_public_id: string;
  readonly machine_status: PolicyInput['machineStatus'];
}

export interface StepRow {
  readonly id: string;
  readonly public_id: string;
  readonly logical_id: string;
  readonly title: string;
  readonly agent_key: string;
  readonly status: string;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly loop_count: number;
  readonly max_loops: number;
  readonly maximum_tool_calls: number;
  readonly exit_criteria: string[];
  readonly result_sanitized: Record<string, unknown> | null;
}

interface ProposedAction {
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly rationale: string;
}

export interface WorkerBrain {
  plan(mission: MissionRow, signal: AbortSignal): Promise<readonly MissionStepPlan[]>;
  propose(
    mission: MissionRow,
    step: StepRow,
    allowedTools: readonly string[],
    signal: AbortSignal,
  ): Promise<{
    readonly summary: string;
    readonly actions: readonly ProposedAction[];
    readonly facts: readonly string[];
    readonly hypotheses: readonly string[];
    readonly risks: readonly string[];
  }>;
  verify(
    mission: MissionRow,
    completedSteps: readonly StepRow[],
    signal: AbortSignal,
  ): Promise<{
    readonly passed: boolean;
    readonly evidence: readonly string[];
    readonly report: string;
  }>;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('json_object_required');
  return value as Record<string, unknown>;
}

function jsonFromModel(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1];
  return JSON.parse((fenced ?? text).trim()) as unknown;
}

function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('string_array_required');
  }
  return value as readonly string[];
}

function modelChoice(mission: MissionRow, fallback: string): ModelChoice {
  const raw = mission.requested_model?.trim() || fallback;
  const [prefix, ...rest] = raw.split(':');
  if (rest.length === 0) return { provider: 'LOCAL', model: raw };
  const provider = (prefix ?? '').toUpperCase();
  if (!['LOCAL', 'OPENAI', 'ANTHROPIC', 'DEEPSEEK', 'MOONSHOT'].includes(provider)) {
    throw new Error('unsupported_model_provider');
  }
  return { provider: provider as ModelChoice['provider'], model: rest.join(':') };
}

class GatewayWorkerBrain implements WorkerBrain {
  constructor(
    private readonly ai: AiGateway,
    private readonly fallbackModel: string,
  ) {}

  async plan(mission: MissionRow, signal: AbortSignal): Promise<readonly MissionStepPlan[]> {
    const choice = modelChoice(mission, this.fallbackModel);
    const generated = await this.ai.generate({
      correlationId: randomUUID(),
      missionId: mission.public_id,
      agentKey: 'SUPERVISOR',
      selection: { default: choice, mission: choice },
      parts: [
        {
          kind: 'USER_INSTRUCTION',
          content: JSON.stringify({
            objective: mission.normalized_goal,
            context: mission.context,
            instruction:
              'Retourne uniquement un objet JSON {steps:[{id,title,dependencies,agentKey,maxAttempts,maxLoops,maximumToolCalls,exitCriteria}]}. Utilise seulement DEVELOPER, TESTING, FILE, SECURITY_REVIEWER ou DEVOPS. Plan court, verifiable et sans action hors objectif.',
          }),
        },
      ],
      budget: {
        maximumInputBytes: 128 * 1024,
        maximumOutputTokens: 2_048,
        maximumEstimatedCostMicrounits: 500_000,
      },
      signal,
    });
    const parsed = record(jsonFromModel(generated.text));
    if (!Array.isArray(parsed.steps)) throw new Error('supervisor_steps_required');
    const steps = parsed.steps.map((raw) => {
      const step = record(raw);
      return {
        id: String(step.id),
        title: String(step.title),
        dependencies: strings(step.dependencies ?? []),
        agentKey: String(step.agentKey),
        maxAttempts: Number(step.maxAttempts ?? 2),
        maxLoops: Number(step.maxLoops ?? 2),
        maximumToolCalls: Number(step.maximumToolCalls ?? 8),
        exitCriteria: strings(step.exitCriteria),
        executionKind: 'SPECIALIST' as const,
      };
    });
    return validateMissionPlan(steps);
  }

  async propose(
    mission: MissionRow,
    step: StepRow,
    allowedTools: readonly string[],
    signal: AbortSignal,
  ) {
    const choice = modelChoice(mission, this.fallbackModel);
    const generated = await this.ai.generate({
      correlationId: randomUUID(),
      missionId: mission.public_id,
      agentKey: step.agent_key,
      selection: { default: choice, mission: choice },
      parts: [
        {
          kind: 'USER_INSTRUCTION',
          content: JSON.stringify({
            objective: mission.normalized_goal,
            step: step.title,
            projectRoot: mission.root_path,
            allowedTools,
            instruction:
              'Retourne uniquement {summary,actions:[{tool,input,rationale}],facts,hypotheses,risks}. Les chemins doivent rester relatifs au projet. N invente aucune permission.',
          }),
        },
      ],
      budget: {
        maximumInputBytes: 128 * 1024,
        maximumOutputTokens: 2_048,
        maximumEstimatedCostMicrounits: 500_000,
      },
      signal,
    });
    return validateAgentProposal(
      jsonFromModel(generated.text),
      step.agent_key as Parameters<typeof validateAgentProposal>[1],
      {
        maximumAiCalls: 1,
        maximumToolCalls: step.maximum_tool_calls,
        maximumIterations: step.max_loops,
        maximumWallClockMs: 120_000,
      },
    );
  }

  async verify(mission: MissionRow, completedSteps: readonly StepRow[], signal: AbortSignal) {
    const choice = modelChoice(mission, this.fallbackModel);
    const generated = await this.ai.generate({
      correlationId: randomUUID(),
      missionId: mission.public_id,
      agentKey: 'SUPERVISOR',
      selection: { default: choice, mission: choice },
      parts: [
        {
          kind: 'USER_INSTRUCTION',
          content: JSON.stringify({
            objective: mission.normalized_goal,
            successCriteria: mission.success_criteria,
            definitionOfDone: mission.definition_of_done,
            steps: completedSteps.map((step) => ({
              id: step.logical_id,
              title: step.title,
              result: step.result_sanitized,
            })),
            instruction:
              'Retourne uniquement {passed:boolean,evidence:string[],report:string}. Ne declare passed que si une preuve objective existe.',
          }),
        },
      ],
      budget: {
        maximumInputBytes: 256 * 1024,
        maximumOutputTokens: 2_048,
        maximumEstimatedCostMicrounits: 500_000,
      },
      signal,
    });
    const parsed = record(jsonFromModel(generated.text));
    return {
      passed: parsed.passed === true,
      evidence: strings(parsed.evidence ?? []),
      report: String(parsed.report ?? ''),
    };
  }
}

const toolCategory = (name: string): ActionCategory =>
  [
    'files.read',
    'files.list',
    'files.search',
    'system.info',
    'system.processes',
    'terminal.readonly',
  ].includes(name)
    ? 'READ'
    : name === 'git.commit'
      ? 'GIT_COMMIT'
      : name === 'git.push'
        ? 'PUSH'
        : name === 'docker.build'
          ? 'CONTAINER_BUILD'
          : name === 'docker.control'
            ? 'CONTAINER_CONTROL'
            : name === 'docker.publish' || name === 'browser.external'
              ? 'PUBLICATION'
              : name === 'terminal.install'
                ? 'DEPENDENCY_INSTALL'
                : name === 'terminal.persistent'
                  ? 'PERSISTENT_PROCESS'
                  : name === 'terminal.network'
                    ? 'NETWORK_ACCESS'
                    : 'WRITE';

export class PostgresMissionWorker {
  private readonly browsers = new Map<
    string,
    Readonly<{ fingerprint: string; service: ControlledBrowserService }>
  >();
  private emergencyStop: FileEmergencyStopLatch | undefined;

  constructor(
    private readonly pool: Pool,
    private readonly brain: WorkerBrain,
    private readonly workerId: string,
    private readonly pollMs = 1_000,
    private readonly dataRoot?: string,
  ) {}

  async closeRuntime(): Promise<void> {
    await Promise.all([...this.browsers.values()].map(({ service }) => service.close()));
    this.browsers.clear();
    this.emergencyStop?.close();
    this.emergencyStop = undefined;
  }

  async run(signal: AbortSignal): Promise<void> {
    await new MissionRuntimeRepository(this.pool).recoverExpired();
    while (!signal.aborted) {
      try {
        const worked = await this.runOnce(signal);
        if (!worked)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, this.pollMs);
            timer.unref?.();
            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'mission.worker.error',
            error: error instanceof Error ? error.message : 'unknown',
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, this.pollMs));
      }
    }
  }

  async runOnce(signal: AbortSignal): Promise<boolean> {
    const mission = await this.claim();
    if (!mission) return false;
    const runtime = new MissionRuntimeRepository(this.pool);
    if (
      !(await runtime.acquireProjectLease({
        missionPublicId: mission.public_id,
        projectPublicId: mission.project_public_id,
        worker: this.workerId,
      }))
    ) {
      await this.blockMission(
        mission.public_id,
        'project_busy',
        'Attendre la liberation du projet puis reprendre',
      );
      return true;
    }
    const heartbeat = setInterval(
      () =>
        void Promise.all([
          runtime.renewLease(mission.public_id, this.workerId, 60),
          runtime.acquireProjectLease({
            missionPublicId: mission.public_id,
            projectPublicId: mission.project_public_id,
            worker: this.workerId,
          }),
        ]).catch(() => undefined),
      30_000,
    );
    heartbeat.unref?.();
    try {
      if (!mission.plan) await this.savePlan(mission, await this.brain.plan(mission, signal));
      for (;;) {
        const step = await this.nextStep(mission.public_id);
        if (!step) break;
        const result = await this.executeStep(mission, step, signal);
        if (result === 'WAITING_APPROVAL' || result === 'BLOCKED') return true;
      }
      const steps = await this.steps(mission.public_id);
      if (steps.some((step) => step.status !== 'COMPLETED' && step.status !== 'SKIPPED'))
        return true;
      const verification = await this.brain.verify(mission, steps, signal);
      if (!verification.passed || verification.evidence.length === 0) {
        await this.blockMission(
          mission.public_id,
          'objective_verification_failed',
          'Fournir une preuve objective reussie',
        );
      } else {
        await this.pool.query(
          `update missions set status='COMPLETED',final_report=$2,remaining_risks='[]'::jsonb,completed_at=now(),lease_owner=null,lease_expires_at=null,version=version+1,updated_at=now() where public_id=$1::uuid and lease_owner=$3`,
          [mission.public_id, verification.report, this.workerId],
        );
        await this.event(mission.public_id, 'MISSION_COMPLETED', {
          evidence: verification.evidence,
        });
      }
      return true;
    } catch (error) {
      await this.blockMission(
        mission.public_id,
        'worker_execution_failed',
        error instanceof Error ? error.message : 'unknown_error',
      );
      return true;
    } finally {
      clearInterval(heartbeat);
      await this.pool.query(
        `delete from project_execution_leases where mission_id=(select id from missions where public_id=$1::uuid) and owner=$2`,
        [mission.public_id, this.workerId],
      );
    }
  }

  private async claim(): Promise<MissionRow | null> {
    const result = await this.pool.query<MissionRow>(
      `with candidate as (select id from missions where status='QUEUED' and not cancellation_requested order by submission_sequence for update skip locked limit 1) update missions m set status='PLANNING',lease_owner=$1,lease_expires_at=now()+interval '60 seconds',execution_epoch=m.execution_epoch+1,started_at=coalesce(m.started_at,now()),updated_at=now(),version=m.version+1 from candidate,users u,projects p,machines mc where m.id=candidate.id and u.id=m.user_id and p.id=m.project_id and mc.id=m.machine_id returning m.id,m.public_id,m.status,m.normalized_goal,m.context,m.success_criteria,m.definition_of_done,m.data_classification,m.requested_provider,m.requested_model,m.plan,m.version,u.id user_id,u.public_id user_public_id,u.status user_status,p.id project_id,p.public_id project_public_id,p.status project_status,p.root_path,p.manifest,mc.id machine_id,mc.public_id machine_public_id,mc.status machine_status`,
      [this.workerId],
    );
    return result.rows[0] ?? null;
  }

  private async savePlan(mission: MissionRow, plan: readonly MissionStepPlan[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `update missions set plan=$2::jsonb,status='RUNNING',version=version+1,updated_at=now() where public_id=$1::uuid and lease_owner=$3`,
        [mission.public_id, JSON.stringify(plan), this.workerId],
      );
      for (let index = 0; index < plan.length; index += 1) {
        const step = plan[index]!;
        await client.query(
          `insert into mission_steps(mission_id,position,title,tool_key,agent_key,dependencies,max_attempts,max_loops,maximum_tool_calls,exit_criteria) select id,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb from missions where public_id=$1::uuid on conflict(mission_id,position) do nothing`,
          [
            mission.public_id,
            index,
            step.title,
            step.id,
            step.agentKey ?? null,
            JSON.stringify(step.dependencies),
            step.maxAttempts,
            step.maxLoops,
            step.maximumToolCalls ?? 8,
            JSON.stringify(step.exitCriteria),
          ],
        );
      }
      await client.query('commit');
      await this.event(mission.public_id, 'MISSION_PLANNED', { steps: plan.length });
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async steps(missionId: string): Promise<readonly StepRow[]> {
    const result = await this.pool.query<StepRow>(
      `select id,public_id,tool_key logical_id,title,agent_key,status,attempts,max_attempts,loop_count,max_loops,maximum_tool_calls,exit_criteria,result_sanitized from mission_steps where mission_id=(select id from missions where public_id=$1::uuid) order by position`,
      [missionId],
    );
    return result.rows;
  }

  private async nextStep(missionId: string): Promise<StepRow | null> {
    const result = await this.pool.query<StepRow>(
      `select s.id,s.public_id,s.tool_key logical_id,s.title,s.agent_key,s.status,s.attempts,s.max_attempts,s.loop_count,s.max_loops,s.maximum_tool_calls,s.exit_criteria,s.result_sanitized from mission_steps s where s.mission_id=(select id from missions where public_id=$1::uuid) and s.status in('PENDING','FAILED','WAITING_APPROVAL') and not exists(select 1 from jsonb_array_elements_text(s.dependencies) d(value) left join mission_steps dependency on dependency.mission_id=s.mission_id and dependency.tool_key=d.value where dependency.status is distinct from 'COMPLETED') order by s.position limit 1`,
      [missionId],
    );
    return result.rows[0] ?? null;
  }

  private async executeStep(
    mission: MissionRow,
    step: StepRow,
    signal: AbortSignal,
  ): Promise<'COMPLETED' | 'WAITING_APPROVAL' | 'BLOCKED'> {
    if (step.attempts >= step.max_attempts || step.loop_count >= step.max_loops) {
      await this.blockMission(
        mission.public_id,
        'step_limits_exhausted',
        `Reviser l etape ${step.logical_id}`,
      );
      return 'BLOCKED';
    }
    const registry = this.registry(mission);
    const allowed = registry.descriptors().map(({ name }) => name);
    const proposal = await this.brain.propose(mission, step, allowed, signal);
    await this.pool.query(
      `update mission_steps set status='RUNNING',attempts=attempts+1,loop_count=loop_count+1,started_at=coalesce(started_at,now()),updated_at=now() where public_id=$1::uuid`,
      [step.public_id],
    );
    const outputs: unknown[] = [];
    for (let index = 0; index < proposal.actions.length; index += 1) {
      const action = proposal.actions[index]!;
      const descriptor = registry.descriptors().find(({ name }) => name === action.tool);
      if (!descriptor) {
        await this.blockMission(mission.public_id, 'tool_not_registered', action.tool);
        return 'BLOCKED';
      }
      const policy = new PolicyEngine(
        {
          record: async (entry) => {
            await this.auditPolicy(mission, entry);
          },
        },
        {
          deniedTools: new Set(),
          allowedTools: new Set(allowed),
          riskDecisions: {
            LOW: 'ALLOW',
            MEDIUM: 'REQUIRE_APPROVAL',
            HIGH: 'REQUIRE_STRONG_APPROVAL',
            CRITICAL: 'REQUIRE_STRONG_APPROVAL',
          },
        },
      );
      const decision = await policy.evaluate({
        userId: mission.user_public_id,
        userStatus: mission.user_status,
        projectId: mission.project_public_id,
        projectStatus: mission.project_status,
        machineId: mission.machine_public_id,
        machineStatus: mission.machine_status,
        tool: { key: action.tool, risk: descriptor.risk, enabled: true },
        parameters: action.input,
        environment: 'LOCAL',
        classification: mission.data_classification,
        actionCategory: toolCategory(action.tool),
        evaluationHealthy: true,
        connectionAvailable: true,
      });
      let authorizationId: string | undefined;
      if (decision.decision !== 'ALLOW') {
        const approved = await this.pool.query<{ public_id: string }>(
          `select a.public_id from approvals a join missions m on m.id=a.mission_id where m.public_id=$1::uuid and a.action_hash=$2 and a.status='APPROVED' order by a.decided_at desc limit 1`,
          [mission.public_id, decision.actionHash],
        );
        const consumed = approved.rows[0];
        if (!consumed) {
          await this.pool.query(
            `insert into approvals(mission_id,action_key,action_hash,parameters_sanitized,level,expires_at) select id,$2,$3,$4::jsonb,$5,now()+interval '15 minutes' from missions where public_id=$1::uuid on conflict(mission_id,action_hash) where status='PENDING' do update set action_key=excluded.action_key,parameters_sanitized=excluded.parameters_sanitized,expires_at=excluded.expires_at`,
            [
              mission.public_id,
              action.tool,
              decision.actionHash,
              JSON.stringify(action.input),
              decision.decision === 'REQUIRE_STRONG_APPROVAL' ? 'STRONG_APPROVAL' : 'APPROVAL',
            ],
          );
          await this.pool.query(
            `update mission_steps set status='WAITING_APPROVAL',result_sanitized=$2::jsonb,updated_at=now() where public_id=$1::uuid`,
            [step.public_id, JSON.stringify({ proposal })],
          );
          await this.pool.query(
            `update missions set status='WAITING_APPROVAL',lease_owner=null,lease_expires_at=null,version=version+1,updated_at=now() where public_id=$1::uuid`,
            [mission.public_id],
          );
          return 'WAITING_APPROVAL';
        }
        authorizationId = consumed.public_id;
      }
      const key = `${mission.public_id}:${step.public_id}:${index}:${decision.actionHash}`;
      const receipts = new MissionRuntimeRepository(this.pool);
      const receipt = await receipts.reserveAction({
        missionPublicId: mission.public_id,
        stepPublicId: step.public_id,
        idempotencyKey: key,
        actionHash: decision.actionHash,
        worker: this.workerId,
      });
      if (receipt.status === 'COMPLETED') {
        outputs.push(receipt.result);
        continue;
      }
      if (!receipt.owned) {
        await this.blockMission(mission.public_id, 'action_outcome_unknown', key);
        return 'BLOCKED';
      }
      const output = await registry.execute(action.tool, action.input, {
        decision: decision.decision,
        actionHash: decision.actionHash,
        ...(authorizationId ? { authorizationId } : {}),
      });
      await receipts.completeAction(receipt.publicId, this.workerId, record(output));
      outputs.push(output);
    }
    await this.pool.query(
      `update mission_steps set status='COMPLETED',result_sanitized=$2::jsonb,completed_at=now(),updated_at=now() where public_id=$1::uuid`,
      [
        step.public_id,
        JSON.stringify({
          summary: proposal.summary,
          facts: proposal.facts,
          hypotheses: proposal.hypotheses,
          risks: proposal.risks,
          outputs,
        }),
      ],
    );
    await this.event(mission.public_id, 'STEP_COMPLETED', { step: step.logical_id });
    return 'COMPLETED';
  }

  private registry(mission: MissionRow): ToolRegistry {
    let manifest: ProjectManifest;
    let persistedManifest = false;
    try {
      manifest = validateProjectManifest(mission.manifest);
      persistedManifest =
        manifest.projectId === mission.project_public_id &&
        manifest.machineId === mission.machine_public_id &&
        win32.normalize(manifest.rootPath).toLowerCase() ===
          win32.normalize(mission.root_path).toLowerCase();
      if (!persistedManifest) throw new Error('manifest_identity_mismatch');
    } catch {
      manifest = {
        version: 1,
        projectId: mission.project_public_id,
        machineId: mission.machine_public_id,
        rootPath: mission.root_path,
        stack: [],
        environments: ['LOCAL'],
        commands: {},
        allowedPaths: ['.'],
        deniedPaths: ['.git'],
        protectedFiles: ['.env'],
        directoryLimits: { '.': { maxFiles: 10_000, maxBytes: 100 * 1024 * 1024 } },
      };
    }
    const files = new LocalFileTools(manifest, { record: async () => undefined });
    const registry = new ToolRegistry();
    const runner = new SecureTerminalRunner(new WindowsProcessController(), new SecretRedactor(), {
      record: async (event) =>
        console.log(JSON.stringify({ event: 'terminal.execution', ...event })),
    });
    const output = objectSchema<Record<string, unknown>>(
      (value): value is Record<string, unknown> => typeof value === 'object',
    );
    const add = (
      name: string,
      risk: ToolRisk,
      validate: (v: Record<string, unknown>) => boolean,
      execute: (v: Record<string, unknown>) => Promise<Record<string, unknown>>,
    ) =>
      registry.register({
        name,
        risk,
        limits: {
          timeoutMs: 30_000,
          maxInputBytes: 2 * 1024 * 1024,
          maxOutputBytes: 4 * 1024 * 1024,
        },
        input: objectSchema<Record<string, unknown>>((value): value is Record<string, unknown> =>
          validate(value),
        ),
        output,
        execute,
      });
    add(
      'files.read',
      'LOW',
      (v) => typeof v.path === 'string',
      async (v) => files.read(String(v.path), Math.min(Number(v.maxBytes ?? 1_048_576), 1_048_576)),
    );
    add(
      'files.list',
      'LOW',
      (v) => typeof v.path === 'string',
      async (v) => ({
        entries: await files.list(String(v.path), Math.min(Number(v.maxEntries ?? 1_000), 10_000)),
      }),
    );
    add(
      'files.search',
      'LOW',
      (v) => typeof v.path === 'string' && typeof v.query === 'string',
      async (v) => ({
        matches: await files.search(String(v.path), String(v.query), {
          maxFiles: 10_000,
          maxResults: 1_000,
          maxFileBytes: 1_048_576,
        }),
      }),
    );
    add(
      'files.write',
      'MEDIUM',
      (v) => typeof v.path === 'string' && typeof v.content === 'string',
      async (v) => ({
        ...(await files.write(
          String(v.path),
          String(v.content),
          Math.min(Number(v.maxBytes ?? 2_097_152), 2_097_152),
        )),
      }),
    );
    add(
      'system.info',
      'LOW',
      (v) => Object.keys(v).length === 0,
      async () => collectSafeSystemInfo() as unknown as Record<string, unknown>,
    );
    add(
      'system.processes',
      'LOW',
      (v) =>
        Number.isSafeInteger(v.maxProcesses) &&
        Number(v.maxProcesses) > 0 &&
        Number(v.maxProcesses) <= 2_000,
      async (v) => ({ processes: await listSafeWindowsProcesses(Number(v.maxProcesses)) }),
    );
    if (Object.keys(manifest.commands).length > 0) {
      registerSecureTerminalTools(registry, {
        resolveProfile: (name) => compileTerminalProfile(manifest, name),
        runner,
      });
    }
    if (persistedManifest) {
      const extensions = advanced(mission.manifest);
      const gitExecutable = windowsExecutable(extensions?.git?.executablePath, ['git.exe']);
      const dockerExecutable = windowsExecutable(extensions?.docker?.executablePath, [
        'docker.exe',
      ]);
      const docker = extensions?.docker;
      const exact = new SecureExactCommandExecutor(runner);
      const git =
        extensions?.git?.enabled === true && gitExecutable
          ? new ControlledGitService(manifest, gitExecutable, exact)
          : undefined;
      const controlledDocker =
        dockerExecutable &&
        docker &&
        /^[a-z0-9][a-z0-9_-]{0,62}$/u.test(docker.projectName) &&
        validStrings(docker.composeFiles) &&
        validStrings(docker.services) &&
        validStrings(docker.imagePrefixes) &&
        ['LOCAL', 'DEVELOPMENT', 'STAGING', 'PRODUCTION'].includes(docker.environment)
          ? new ControlledDockerService(manifest, docker, dockerExecutable, exact)
          : undefined;
      if (git || controlledDocker) {
        registerDevelopmentTools(registry, {
          ...(git ? { git } : {}),
          ...(controlledDocker ? { docker: controlledDocker } : {}),
        });
      }
      this.registerBrowserTools(registry, mission, manifest, extensions?.browser);
      this.registerComputerTools(registry, mission, extensions?.computerUse);
    }
    return registry;
  }

  private registerBrowserTools(
    registry: ToolRegistry,
    mission: MissionRow,
    manifest: ProjectManifest,
    configuration: AdvancedManifest['browser'],
  ): void {
    if (!this.dataRoot || !configuration || !validStrings(configuration.allowedDomains)) return;
    const executable = windowsExecutable(configuration.executablePath, [
      'chrome.exe',
      'msedge.exe',
    ]);
    if (!executable) return;
    const domains = new Set(
      configuration.allowedDomains
        .map((domain) => domain.toLowerCase())
        .filter((domain) =>
          /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
            domain,
          ),
        ),
    );
    if (domains.size !== configuration.allowedDomains.length) return;
    const root = join(this.dataRoot, 'browser', mission.project_public_id);
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          executable,
          domains: [...domains].sort(),
          headless: configuration.headless ?? true,
        }),
      )
      .digest('hex');
    const current = this.browsers.get(mission.project_public_id);
    let browser = current?.fingerprint === fingerprint ? current.service : undefined;
    if (current && !browser) void current.service.close();
    if (!browser) {
      browser = new ControlledBrowserService(
        join(root, 'profile'),
        root,
        domains,
        new PlaywrightChromeDriver({
          chromeExecutable: executable,
          allowedDomains: domains,
          downloadsDirectory: join(root, 'downloads'),
          quarantineDirectory: join(root, 'quarantine'),
          evidenceDirectory: join(root, 'evidence'),
          headless: configuration.headless ?? true,
        }),
        {
          authorize: async ({ actionHash, registryAuthorization }) => {
            const approved = await this.isStrongApproval(mission, registryAuthorization);
            return { approved, pinVerified: approved, actionHash };
          },
        },
        {
          record: async (event) => this.event(mission.public_id, 'BROWSER_ACTION', event),
        },
      );
      this.browsers.set(mission.project_public_id, { fingerprint, service: browser });
    }
    registerControlledBrowserTools(registry, browser, manifest);
  }

  private registerComputerTools(
    registry: ToolRegistry,
    mission: MissionRow,
    configuration: AdvancedManifest['computerUse'],
  ): void {
    if (!this.dataRoot || !configuration || !Array.isArray(configuration.applications)) return;
    const applications = new Map<string, ManagedApplicationDefinition>();
    for (const item of configuration.applications) {
      const executable = windowsExecutable(item.executablePath, [
        'chrome.exe',
        'msedge.exe',
        'code.exe',
        'notepad.exe',
        'explorer.exe',
      ]);
      if (
        !executable ||
        typeof item.appKey !== 'string' ||
        !/^[a-z][a-z0-9_-]{0,63}$/u.test(item.appKey) ||
        (item.executableSha256 !== undefined && !/^[a-f0-9]{64}$/iu.test(item.executableSha256)) ||
        (item.windowTitles !== undefined && !validStrings(item.windowTitles)) ||
        (item.windowTitlePrefixes !== undefined && !validStrings(item.windowTitlePrefixes))
      )
        return;
      applications.set(item.appKey, {
        appKey: item.appKey,
        executablePath: executable,
        ...(item.executableSha256 === undefined
          ? {}
          : { executableSha256: item.executableSha256.toLowerCase() }),
        launchProfile: {
          windowTitles: item.windowTitles ?? [],
          windowTitlePrefixes: item.windowTitlePrefixes ?? [],
        },
      });
    }
    if (applications.size === 0) return;
    this.emergencyStop ??= new FileEmergencyStopLatch(
      join(this.dataRoot, 'computer-use.stop.json'),
    );
    const driver = new WindowsDesktopDriver();
    const core = new ComputerUseCore(
      driver,
      new ManagedApplicationCatalog(
        { findEnabled: async (key) => applications.get(key) },
        new WindowsProcessIdentityProvider(),
      ),
      {
        evaluate: async ({ registryAuthorization }) =>
          (await this.isStrongApproval(mission, registryAuthorization))
            ? 'ALLOW'
            : 'REQUIRE_STRONG_APPROVAL',
      },
      { record: async (event) => this.event(mission.public_id, 'COMPUTER_USE_ACTION', event) },
      new UiLeaseManager(),
      this.emergencyStop,
    );
    registerComputerUseTools(registry, driver, {
      execute: (input) => {
        if (input.missionId !== mission.public_id) throw new Error('mission_identity_mismatch');
        return core.execute(input);
      },
    });
  }

  private async isStrongApproval(
    mission: MissionRow,
    authorization: ToolAuthorization | undefined,
  ): Promise<boolean> {
    if (
      authorization?.decision !== 'REQUIRE_STRONG_APPROVAL' ||
      typeof authorization.authorizationId !== 'string'
    )
      return false;
    const result = await this.pool.query(
      `select 1 from approvals a join missions m on m.id=a.mission_id where m.public_id=$1::uuid and a.public_id=$2::uuid and a.action_hash=$3 and a.status='APPROVED' and a.level='STRONG_APPROVAL' and a.expires_at>now() limit 1`,
      [mission.public_id, authorization.authorizationId, authorization.actionHash],
    );
    return result.rowCount === 1;
  }

  private async blockMission(id: string, reason: string, action: string): Promise<void> {
    await this.pool.query(
      `update missions set status='BLOCKED',blocked_reason=$2,blocked_action=$3,lease_owner=null,lease_expires_at=null,version=version+1,updated_at=now() where public_id=$1::uuid`,
      [id, reason.slice(0, 500), action.slice(0, 2_000)],
    );
    await this.event(id, 'MISSION_BLOCKED', { reason, action });
  }

  private async event(id: string, type: string, detail: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `insert into mission_events(mission_id,sequence,event_type,payload_sanitized) select id,coalesce((select max(sequence)+1 from mission_events where mission_id=missions.id),1),$2,$3::jsonb from missions where public_id=$1::uuid`,
      [id, type, JSON.stringify(detail)],
    );
  }

  private async auditPolicy(
    mission: MissionRow,
    entry: { actionHash: string; decision: string; reason: string; tool: string; risk: ToolRisk },
  ): Promise<void> {
    await this.pool.query(
      `select append_audit_log('POLICY','TOOL_POLICY_EVALUATED',$1::uuid,$2::jsonb,$3::jsonb,$4,$5,$6,$7,$8)`,
      [
        randomUUID(),
        JSON.stringify({ tool: entry.tool, actionHash: entry.actionHash }),
        JSON.stringify({ decision: entry.decision, reason: entry.reason }),
        entry.risk,
        mission.user_id,
        mission.machine_id,
        mission.project_id,
        mission.id,
      ],
    );
  }
}

function definitions(configuration: RuntimeConfiguration): readonly ModelDefinition[] {
  const choices = [configuration.localModel, ...configuration.cloudModels];
  return choices.map((raw, index) => {
    const choice = modelChoice({ requested_model: raw } as MissionRow, configuration.localModel);
    return {
      provider: choice.provider,
      id: choice.model,
      enabled: true,
      available: true,
      contextTokens: 32_768,
      maximumOutputTokens: 4_096,
      maximumClassification: choice.provider === 'LOCAL' ? 'SECRET' : 'CLOUD_SAFE',
      inputCostMicrounitsPerMillion: index === 0 ? 0 : 1_000_000,
      outputCostMicrounitsPerMillion: index === 0 ? 0 : 2_000_000,
      capabilities: { text: true, vision: false, tools: false, structuredOutput: false },
    };
  });
}

export async function createProductionMissionWorker(
  environment = process.env,
): Promise<{ worker: PostgresMissionWorker; close(): Promise<void> }> {
  const dataRoot = environment.ARCC_DATA_ROOT;
  const connectionString = environment.DATABASE_URL;
  if (!dataRoot || !connectionString)
    throw new Error('ARCC_DATA_ROOT and DATABASE_URL are required');
  const configuration = JSON.parse(
    await readFile(join(dataRoot, 'config.json'), 'utf8'),
  ) as RuntimeConfiguration;
  const vault = await LocalSecretVault.open(
    new FileVaultStore(join(dataRoot, 'vault.json')),
    new WindowsDpapiKeyProtector(),
  );
  const pool = new Pool({ connectionString, max: 4, idleTimeoutMillis: 30_000 });
  await pool.query('select 1');
  const transport = new AllowlistedJsonHttpTransport(
    {
      LOCAL_MODEL: ['http://127.0.0.1:11434/api/chat'],
      OPENAI: ['https://api.openai.com/v1/responses'],
      ANTHROPIC: ['https://api.anthropic.com/v1/messages'],
      DEEPSEEK: ['https://api.deepseek.com/chat/completions'],
      MOONSHOT: ['https://api.moonshot.ai/v1/chat/completions'],
    },
    {
      resolve: async (key) => {
        const name = `provider-${key.replace('_API_KEY', '').toLowerCase()}`;
        try {
          return vault.get(name);
        } catch (error) {
          if (error instanceof SecretNotFoundError) return '';
          throw error;
        }
      },
    },
  );
  const ai = createAiRuntime({
    models: definitions(configuration),
    transport,
    audit: new SqlModelRunAuditSink(pool),
    egressAudit: {
      record: async (event) => {
        console.log(
          JSON.stringify({
            event: 'ai.egress',
            destination: event.destination,
            decision: event.decision,
            reason: event.reason,
          }),
        );
      },
    },
    enabledCloudDestinations: ['OPENAI', 'ANTHROPIC', 'DEEPSEEK', 'MOONSHOT'],
  });
  const worker = new PostgresMissionWorker(
    pool,
    new GatewayWorkerBrain(ai, configuration.localModel),
    `desktop-${process.pid}`,
    1_000,
    dataRoot,
  );
  return {
    worker,
    close: async () => {
      await worker.closeRuntime();
      vault.close();
      await pool.end();
    },
  };
}
