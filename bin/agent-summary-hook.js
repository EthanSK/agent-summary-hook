#!/usr/bin/env node
import { runCli } from "../src/cli.js";

const code = await runCli();
process.exitCode = code;
