import { randomUUID } from 'node:crypto';
import type { Settings } from './settingsStore.ts';

export const OPERATION_STATUSES = ['pending', 'approved', 'denied', 'auto-approved', 'auto-denied'] as const;
export type OperationStatus = typeof OPERATION_STATUSES[number];

export interface OperationInput {
  type: 'browser' | 'app' | 'shell';
  target: string;
  action: string;
  params?: Record<string, unknown>;
}

export interface Operation extends OperationInput {
  id: string;
  status: OperationStatus;
  reason?: string;
  createdAtMs: number;
  resolvedAtMs?: number;
  approver?: 'connector';
}

// Process-local MVP state, like /metrics: both resources reset on restart.
// This journal coordinates approvals only; it never executes an action.
export class HandsStore {
  private readonly operations: Operation[] = [];
  private targets: string[] = [];

  createOperation(input: OperationInput, hands: Settings['hands']): Operation {
    const createdAtMs = Date.now();
    const operation: Operation = {
      ...structuredClone(input), id: randomUUID(), status: 'pending', createdAtMs,
    };
    if (input.type === 'browser' && hands.browserControl === false) {
      operation.status = 'auto-denied';
      operation.reason = 'browser_control_disabled';
    } else if (hands.confirmMode === false && this.targets.includes(input.target)) {
      operation.status = 'auto-approved';
    }
    if (operation.status !== 'pending') operation.resolvedAtMs = createdAtMs;
    this.operations.push(operation);
    if (this.operations.length > 50) this.operations.shift();
    return structuredClone(operation);
  }

  list(status?: OperationStatus): Operation[] {
    return structuredClone(this.operations.filter(operation => !status || operation.status === status).reverse());
  }

  get(id: string): Operation | undefined {
    return structuredClone(this.operations.find(operation => operation.id === id));
  }

  approve(id: string): Operation | undefined {
    return this.resolve(id, 'approved');
  }

  deny(id: string): Operation | undefined {
    return this.resolve(id, 'denied');
  }

  private resolve(id: string, status: 'approved' | 'denied'): Operation | undefined {
    const operation = this.operations.find(operation => operation.id === id);
    if (!operation) return undefined;
    if (operation.status !== 'pending') throw new Error('NOT_PENDING');
    operation.status = status;
    operation.resolvedAtMs = Date.now();
    operation.approver = 'connector';
    return structuredClone(operation);
  }

  getAllowlist(): string[] {
    return [...this.targets];
  }

  setAllowlist(targets: string[]): string[] {
    this.targets = [...new Set(targets.map(target => target.trim()).filter(Boolean))];
    return this.getAllowlist();
  }
}
