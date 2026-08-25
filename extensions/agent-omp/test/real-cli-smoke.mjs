import { spawn } from "node:child_process";

if (process.env.TERMINAY_RUN_OMP_REAL_CLI !== "1") {
  console.log("Skipped: set TERMINAY_RUN_OMP_REAL_CLI=1 to run the opt-in local OMP CLI smoke test.");
  process.exit(0);
}

const child = spawn("omp", ["--help"], { stdio: "inherit" });
child.once("error", (error) => {
  console.error(`OMP CLI smoke unavailable: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code) => { process.exitCode = code ?? 1; });
