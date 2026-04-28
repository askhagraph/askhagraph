/**
 * @module engine-process
 * Child process management for the AskhaGraph Core Engine.
 *
 * Spawns the Core Engine as a child process, communicates via stdio JSON,
 * and handles timeouts, crashes, and malformed responses.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as vscode from 'vscode';
import {
  ERR_MALFORMED_RESPONSE,
  ACTION_RETRY,
  errEngineTimeout,
  errEngineCrash,
} from './constants.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Request envelope for stdio communication with the Core Engine. */
export interface EngineRequest {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}

/** Response envelope from the Core Engine. */
export interface EngineResponse {
  id: string;
  type: 'result' | 'candidates' | 'error' | 'progress';
  payload: Record<string, unknown>;
}

/** Pending request awaiting a response. */
interface PendingRequest {
  resolve: (response: EngineResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

// ─── Output Channel ──────────────────────────────────────────────────────────

let outputChannel: vscode.OutputChannel | null = null;

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('AskhaGraph');
  }
  return outputChannel;
}

/**
 * Dispose the shared output channel.
 * Called during extension deactivation.
 */
export function disposeOutputChannel(): void {
  if (outputChannel) {
    outputChannel.dispose();
    outputChannel = null;
  }
}

// ─── EngineProcess ───────────────────────────────────────────────────────────

/**
 * Manages the Core Engine child process lifecycle.
 * Handles spawning, stdio communication, timeouts, and crash recovery.
 */
export class EngineProcess {
  private process: ChildProcess | null = null;
  private pending = new Map<string, PendingRequest>();
  private buffer = '';
  private timeoutMs: number;
  private enginePath: string;
  private projectRoot: string;

  /**
   * @param enginePath - Path to the Core Engine entry script.
   * @param projectRoot - The workspace root directory.
   * @param timeoutMs - Timeout in milliseconds for engine responses (default: 60000).
   */
  constructor(enginePath: string, projectRoot: string, timeoutMs = 60_000) {
    this.enginePath = enginePath;
    this.projectRoot = projectRoot;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Spawn the Core Engine child process.
   * If already running, this is a no-op.
   */
  start(): void {
    if (this.process && !this.process.killed) {
      return;
    }

    const channel = getOutputChannel();
    channel.appendLine(`[AskhaGraph] Starting Core Engine: ${this.enginePath}`);
    channel.appendLine(`[AskhaGraph] Working directory: ${this.projectRoot}`);

    this.process = spawn('node', ['--max-old-space-size=4096', this.enginePath], {
      cwd: this.projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    this.buffer = '';

    this.process.stdout?.on('data', (data: Buffer) => {
      this.onStdoutData(data.toString());
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      channel.appendLine(`[AskhaGraph stderr] ${data.toString().trim()}`);
    });

    this.process.on('error', (err: Error) => {
      channel.appendLine(`[AskhaGraph] Process error: ${err.message}`);
      this.handleCrash(`Process error: ${err.message}`);
    });

    this.process.on('exit', (code: number | null, signal: string | null) => {
      channel.appendLine(
        `[AskhaGraph] Process exited (code=${code}, signal=${signal})`,
      );
      this.process = null;

      // If there are pending requests, this is an unexpected crash
      if (this.pending.size > 0) {
        this.handleCrash(
          `Core Engine exited unexpectedly (code=${code}, signal=${signal})`,
        );
      }
    });

    channel.appendLine('[AskhaGraph] Core Engine process started');
  }

  /**
   * Send a request to the Core Engine and wait for the response.
   *
   * @param request - The request to send.
   * @returns A promise that resolves with the engine response.
   * @throws If the process is not running, times out, or crashes.
   */
  sendRequest(request: EngineRequest): Promise<EngineResponse> {
    return new Promise<EngineResponse>((resolve, reject) => {
      if (!this.process || this.process.killed) {
        reject(new Error('Core Engine process is not running'));
        return;
      }

      const pending: PendingRequest = {
        resolve,
        reject,
        timer: null,
      };

      // Set up timeout
      pending.timer = setTimeout(() => {
        this.pending.delete(request.id);
        const channel = getOutputChannel();
        channel.appendLine(
          `[AskhaGraph] Request ${request.id} timed out after ${this.timeoutMs}ms`,
        );
        this.handleTimeout(request.id);
        reject(new Error(`Request timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pending.set(request.id, pending);

      // Write the request as newline-delimited JSON
      const json = JSON.stringify(request) + '\n';
      this.process.stdin?.write(json, (err) => {
        if (err) {
          this.pending.delete(request.id);
          if (pending.timer) {
            clearTimeout(pending.timer);
          }
          reject(new Error(`Failed to write to engine stdin: ${err.message}`));
        }
      });
    });
  }

  /**
   * Stop the Core Engine child process.
   */
  stop(): void {
    if (this.process && !this.process.killed) {
      const channel = getOutputChannel();
      channel.appendLine('[AskhaGraph] Stopping Core Engine process');
      this.process.kill('SIGTERM');
      this.process = null;
    }

    // Reject all pending requests
    for (const [id, pending] of this.pending) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(new Error('Core Engine process stopped'));
      this.pending.delete(id);
    }
  }

  /**
   * Check if the Core Engine process is currently running.
   */
  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  // ─── Private Methods ─────────────────────────────────────────────────────────

  private onStdoutData(data: string): void {
    this.buffer += data;

    // Process complete lines (newline-delimited JSON)
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line) {
        this.onResponseLine(line);
      }
    }
  }

  private onResponseLine(line: string): void {
    const channel = getOutputChannel();

    let response: EngineResponse;
    try {
      response = JSON.parse(line) as EngineResponse;
    } catch {
      // Malformed response
      channel.appendLine(`[AskhaGraph] Malformed response: ${line}`);
      this.handleMalformedResponse(line);
      return;
    }

    if (!response.id || !response.type) {
      channel.appendLine(
        `[AskhaGraph] Response missing id or type: ${line}`,
      );
      this.handleMalformedResponse(line);
      return;
    }

    // Progress messages don't resolve the pending request
    if (response.type === 'progress') {
      channel.appendLine(
        `[AskhaGraph] Progress: ${JSON.stringify(response.payload)}`,
      );
      return;
    }

    const pending = this.pending.get(response.id);
    if (pending) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      this.pending.delete(response.id);
      pending.resolve(response);
    } else {
      channel.appendLine(
        `[AskhaGraph] Received response for unknown request: ${response.id}`,
      );
    }
  }

  private handleTimeout(requestId: string): void {
    // Kill the unresponsive process
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
      this.process = null;
    }

    void vscode.window
      .showErrorMessage(
        errEngineTimeout(this.timeoutMs / 1000),
        ACTION_RETRY,
      )
      .then((action) => {
        if (action === ACTION_RETRY) {
          this.start();
        }
      });
  }

  private handleCrash(reason: string): void {
    const channel = getOutputChannel();
    channel.appendLine(`[AskhaGraph] Crash detected: ${reason}`);

    // Reject all pending requests
    for (const [id, pending] of this.pending) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(new Error(`Core Engine crashed: ${reason}`));
      this.pending.delete(id);
    }

    void vscode.window
      .showErrorMessage(
        errEngineCrash(reason),
        ACTION_RETRY,
      )
      .then((action) => {
        if (action === ACTION_RETRY) {
          this.start();
        }
      });
  }

  private handleMalformedResponse(rawResponse: string): void {
    const channel = getOutputChannel();
    channel.appendLine(`[AskhaGraph] Raw malformed response: ${rawResponse}`);

    void vscode.window.showErrorMessage(ERR_MALFORMED_RESPONSE);
  }
}
