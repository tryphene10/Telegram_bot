export interface SqlResult<Row> {
  readonly rows: readonly Row[];
  readonly rowCount: number;
}

export interface SqlClient {
  query<Row>(text: string, values?: readonly unknown[]): Promise<SqlResult<Row>>;
}

export class ConcurrentUpdateError extends Error {
  constructor(entity: string, publicId: string) {
    super(`${entity} ${publicId} was modified concurrently`);
    this.name = 'ConcurrentUpdateError';
  }
}
