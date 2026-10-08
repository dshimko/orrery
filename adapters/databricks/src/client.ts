// SPDX-License-Identifier: Apache-2.0
import {
  SqlError,
  type AllowedQuery,
  type QueryOptions,
  type Row,
  type SqlClient,
  type SqlParam,
  type Target,
  type TokenProvider,
} from './contracts.js';

const STATEMENTS_PATH = '/api/2.0/sql/statements';
const MAX_WAIT_TIMEOUT_S = 50;
const MIN_WAIT_TIMEOUT_S = 5;
const INITIAL_POLL_MS = 100;
const MAX_POLL_MS = 2000;
const MAX_RETRY_AFTER_MS = 10_000;
const CANCEL_TIMEOUT_MS = 5000;
const TERMINAL_STATES: ReadonlySet<string> = new Set(['SUCCEEDED', 'FAILED', 'CANCELED', 'CLOSED']);

interface StatementError {
  error_code?: string;
}

interface ResultChunk {
  data_array?: (string | null)[][];
  next_chunk_internal_link?: string;
}

interface StatementResponse {
  statement_id?: string;
  status?: { state?: string; error?: StatementError };
  manifest?: { schema?: { columns?: { name?: string }[] } };
  result?: ResultChunk;
}

/** Maps a Databricks error code or HTTP status to the adapter's error codes. */
export function mapError(
  httpStatus: number | undefined,
  errorCode: string | undefined,
): 'not_found' | 'permission_denied' | 'rate_limited' | 'too_large' | 'failed' {
  const code = (errorCode ?? '').toUpperCase();
  if (httpStatus === 404 || code.includes('NOT_FOUND')) return 'not_found';
  if (
    httpStatus === 403 ||
    code.includes('PERMISSION_DENIED') ||
    code.includes('INSUFFICIENT_PERMISSIONS')
  ) {
    return 'permission_denied';
  }
  if (httpStatus === 429) return 'rate_limited';
  if (code.includes('TOO_LARGE') || code.includes('RESULT_SIZE')) return 'too_large';
  return 'failed';
}

function safeCode(code: string | undefined): string {
  return code !== undefined && /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : 'UNKNOWN';
}

function waitTimeoutParam(timeoutMs: number): string {
  const seconds = Math.floor(timeoutMs / 1000);
  if (seconds < MIN_WAIT_TIMEOUT_S) return '0s';
  return `${Math.min(seconds, MAX_WAIT_TIMEOUT_S)}s`;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

/** One in-flight query: owns the deadline, abort handling, and the single 429 retry. */
class Execution {
  private readonly deadline: number;
  private readonly signal: AbortSignal;
  private retriedRateLimit = false;
  private statementId: string | undefined;
  private reachedTerminal = false;

  constructor(
    private readonly target: Target,
    private readonly tokens: TokenProvider,
    private readonly fetchImpl: typeof fetch,
    private readonly query: AllowedQuery,
    private readonly options: QueryOptions,
  ) {
    this.deadline = Date.now() + options.timeoutMs;
    const signals = [AbortSignal.timeout(options.timeoutMs)];
    if (options.signal) signals.push(options.signal);
    this.signal = AbortSignal.any(signals);
  }

  async run(params: readonly SqlParam[]): Promise<Row[]> {
    try {
      return await this.runInner(params);
    } catch (error) {
      if (this.statementId !== undefined && !this.reachedTerminal) {
        await this.cancelRemote(this.statementId);
      }
      if (error instanceof SqlError && error.code !== 'canceled' && error.code !== 'timeout') {
        throw error;
      }
      throw this.interruption() ?? error;
    }
  }

  private interruption(): SqlError | undefined {
    if (this.options.signal?.aborted) {
      return new SqlError('canceled', `Query "${this.query.name}" was canceled.`, this.query.name);
    }
    if (this.signal.aborted || Date.now() >= this.deadline) {
      return new SqlError('timeout', `Query "${this.query.name}" timed out.`, this.query.name);
    }
    return undefined;
  }

  private fail(code: SqlError['code'], detail: string): SqlError {
    return new SqlError(code, `Query "${this.query.name}" failed: ${detail}`, this.query.name);
  }

  private async runInner(params: readonly SqlParam[]): Promise<Row[]> {
    const body = {
      warehouse_id: this.target.warehouseId,
      statement: this.query.sql,
      parameters: params.map((p) => ({ name: p.name, value: p.value, type: p.type })),
      wait_timeout: waitTimeoutParam(this.options.timeoutMs),
      on_wait_timeout: 'CONTINUE',
      row_limit: this.options.rowLimit,
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
    };
    let response = await this.send('POST', STATEMENTS_PATH, body);
    if (response.statement_id !== undefined) this.statementId = response.statement_id;
    let delay = INITIAL_POLL_MS;
    while (!TERMINAL_STATES.has(response.status?.state ?? '')) {
      if (this.statementId === undefined) throw this.fail('failed', 'no statement id returned');
      await this.wait(delay);
      delay = Math.min(delay * 2, MAX_POLL_MS);
      response = await this.send('GET', `${STATEMENTS_PATH}/${this.statementId}`);
    }
    this.reachedTerminal = true;
    return this.collect(response);
  }

  private async wait(ms: number): Promise<void> {
    try {
      await sleep(ms, this.signal);
    } catch {
      throw this.interruption() ?? this.fail('canceled', 'aborted');
    }
  }

  private async collect(response: StatementResponse): Promise<Row[]> {
    const state = response.status?.state;
    if (state !== 'SUCCEEDED') {
      const code = response.status?.error?.error_code;
      if (state === 'CANCELED' || state === 'CLOSED') {
        throw this.fail('failed', `statement ${state}`);
      }
      throw this.fail(mapError(undefined, code), safeCode(code));
    }
    const columns = (response.manifest?.schema?.columns ?? []).map((c) => c.name ?? '');
    const rows: Row[] = [];
    const limit = this.options.rowLimit;
    let chunk: ResultChunk | undefined = response.result;
    while (chunk !== undefined) {
      for (const values of chunk.data_array ?? []) {
        if (rows.length >= limit) return rows;
        rows.push(Object.fromEntries(columns.map((name, i) => [name, values[i] ?? null])));
      }
      const link: string | undefined = chunk.next_chunk_internal_link;
      if (link === undefined || rows.length >= limit) break;
      if (!link.startsWith(`${STATEMENTS_PATH}/`) || link.includes('..')) {
        throw this.fail('failed', 'unexpected chunk link');
      }
      chunk = (await this.send('GET', link)) as ResultChunk;
    }
    return rows;
  }

  private async send(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<StatementResponse> {
    const token = await this.tokens.token(this.signal);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.target.host}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'orrery',
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: this.signal,
      });
    } catch {
      throw this.interruption() ?? this.fail('failed', 'connection error');
    }
    if (response.status === 429 && !this.retriedRateLimit) {
      this.retriedRateLimit = true;
      const delay = parseRetryAfterMs(response.headers.get('retry-after'));
      if (delay !== undefined && Date.now() + delay < this.deadline) {
        await this.wait(delay);
        return this.send(method, path, body);
      }
    }
    const payload = (await response.json().catch(() => ({}))) as
      (StatementResponse & StatementError) | undefined;
    if (!response.ok) {
      const code = payload?.error_code;
      throw this.fail(mapError(response.status, code), `HTTP ${response.status} ${safeCode(code)}`);
    }
    return payload ?? {};
  }

  /** Best effort: the statement is already abandoned from our side, so failures are ignored. */
  private async cancelRemote(statementId: string): Promise<void> {
    try {
      const token = await this.tokens.token(AbortSignal.timeout(CANCEL_TIMEOUT_MS));
      await this.fetchImpl(`${this.target.host}${STATEMENTS_PATH}/${statementId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'orrery' },
        signal: AbortSignal.timeout(CANCEL_TIMEOUT_MS),
      });
    } catch {
      // Cancellation is advisory; the warehouse also enforces its own statement timeout.
    }
  }
}

/** SQL Statement Execution API client. Only allowlisted queries are accepted. */
export function createStatementClient(
  target: Target,
  tokens: TokenProvider,
  fetchImpl: typeof fetch = fetch,
): SqlClient {
  return {
    execute(query, params, options): Promise<Row[]> {
      return new Execution(target, tokens, fetchImpl, query, options).run(params);
    },
  };
}
