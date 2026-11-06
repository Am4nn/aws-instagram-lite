import { SFNClient, StartExecutionCommand, DescribeExecutionCommand } from "@aws-sdk/client-sfn";
import { check, assert, type Outputs } from "./util.js";

export async function run(o: Outputs) {
  const sfn = new SFNClient({});
  return [
    await check("Step Functions", "Standard workflow Pass → Lambda task → Succeed", async () => {
      const { executionArn } = await sfn.send(new StartExecutionCommand({
        stateMachineArn: o.StateMachineArn, input: JSON.stringify({ hello: "spike" }),
      }));
      const until = Date.now() + 60000;
      while (Date.now() < until) {
        const d = await sfn.send(new DescribeExecutionCommand({ executionArn }));
        if (d.status === "SUCCEEDED") {
          assert(d.output?.includes("spike"), `output missing input: ${d.output}`);
          return `output ${d.output}`;
        }
        assert(d.status === "RUNNING", `status ${d.status} ${d.error ?? ""} ${d.cause ?? ""}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error("still RUNNING after 60s");
    }),
  ];
}
