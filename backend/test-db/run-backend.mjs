import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const backendDirectory = resolve(testDirectory, "..");
const repositoryDirectory = resolve(backendDirectory, "..");
const compilerPath = resolve(repositoryDirectory, "frontend/node_modules/typescript");

const dedicatedEnv = resolve(testDirectory, ".env");
const backendEnv = resolve(backendDirectory, ".env");

if (!existsSync(dedicatedEnv)) {
  throw new Error("Prepare the dedicated test database first");
}
if (!existsSync(backendEnv)) {
  throw new Error("backend/.env is missing; the test setup will not overwrite an existing environment");
}
if (realpathSync(backendEnv) !== realpathSync(dedicatedEnv)) {
  throw new Error("backend/.env must point to backend/test-db/.env before starting this test server");
}
if (!existsSync(compilerPath)) {
  throw new Error("Install frontend dependencies to provide the pinned TypeScript compiler");
}

const server = spawn(process.execPath, ["-r", "ts-node/register", "src/server.ts"], {
  cwd: backendDirectory,
  stdio: "inherit",
  env: {
    ...process.env,
    TS_NODE_COMPILER: compilerPath,
    TS_NODE_COMPILER_OPTIONS: JSON.stringify({ esModuleInterop: true })
  }
});

server.on("error", error => {
  console.error(error.message);
  process.exitCode = 1;
});
server.on("exit", (code, signal) => {
  process.exitCode = signal ? 0 : (code ?? 1);
});
