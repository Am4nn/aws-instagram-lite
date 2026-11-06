import {
  CloudFormationClient, ListStacksCommand, DeleteStackCommand, waitUntilStackDeleteComplete,
} from "@aws-sdk/client-cloudformation";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

export const BOOTSTRAP_PARAM = "/cdk-bootstrap/hnb659fds/version";

/**
 * `floci reset` wipes resources but keeps CloudFormation stack records, so CDK
 * thinks everything is deployed ("no changes"). If the bootstrap param is gone,
 * our stacks (deleted first) and CDKToolkit (last) are stale.
 */
export function staleStacks(stackNames: string[], bootstrapParamExists: boolean): string[] {
  if (bootstrapParamExists) return [];
  const ours = stackNames.filter((n) => n.startsWith("ig-local-"));
  return [...ours, ...(stackNames.includes("CDKToolkit") ? ["CDKToolkit"] : [])];
}

/** Deletes stale stack records so bootstrap + deploy recreate everything. */
export async function cleanStaleStacks(): Promise<string[]> {
  const cfn = new CloudFormationClient({});
  const ssm = new SSMClient({});
  const exists = await ssm.send(new GetParameterCommand({ Name: BOOTSTRAP_PARAM }))
    .then(() => true, () => false);
  const { StackSummaries = [] } = await cfn.send(new ListStacksCommand({
    StackStatusFilter: ["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE", "ROLLBACK_COMPLETE"],
  }));
  const stale = staleStacks(StackSummaries.map((s) => s.StackName!), exists);
  for (const StackName of stale) {
    await cfn.send(new DeleteStackCommand({ StackName }));
    await waitUntilStackDeleteComplete({ client: cfn, maxWaitTime: 120 }, { StackName });
  }
  return stale;
}
