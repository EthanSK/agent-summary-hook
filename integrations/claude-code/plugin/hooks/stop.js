#!/usr/bin/env node
import { runCli } from "../../../../src/cli.js";

try {
  await runCli(["claude-stop"], {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
  });
} catch (error) {
  console.log(JSON.stringify({ systemMessage: `agent-summary-hook Stop failed open: ${String(error)}` }));
}
process.exitCode = 0;
