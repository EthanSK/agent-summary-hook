#!/usr/bin/env node
import { runCli } from "../../../../src/cli.js";

try {
  await runCli(["claude-user-prompt"], {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
  });
} catch (error) {
  console.log(JSON.stringify({ systemMessage: `agent-summary-hook UserPromptSubmit failed open: ${String(error)}` }));
}
process.exitCode = 0;
