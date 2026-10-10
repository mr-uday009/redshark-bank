// Ambient type declaration for the optional `ibm_db` package.
//
// `ibm_db` is the Node.js driver for IBM Db2 (the closest Node
// equivalent of the Java db2jcc4.jar JDBC driver). It ships native
// bindings and is only needed when this app is deployed somewhere with
// real network access to a Db2 for z/OS server, so it is intentionally
// NOT installed as a hard dependency of this sandbox project (installing
// it here would require downloading IBM's CLI driver, which this
// environment cannot reach anyway).
//
// To enable real z/OS connectivity in your own deployment:
//   npm install ibm_db
// and configure the DB2_* environment variables described in
// src/lib/db2.ts / README-DB2.md.
declare module "ibm_db" {
  export interface Db2Connection {
    query<T = Record<string, unknown>>(
      sql: string,
      params?: unknown[]
    ): Promise<T[]>;
    close(): Promise<void>;
    closeSync(): void;
  }

  export function open(connectionString: string): Promise<Db2Connection>;
  export function open(
    connectionString: string,
    callback: (err: Error | null, conn: Db2Connection) => void
  ): void;

  const ibmdb: {
    open: typeof open;
  };
  export default ibmdb;
}
