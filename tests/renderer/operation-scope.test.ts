import { expect, it } from "vitest";
import { OperationScope } from "../../src/renderer/state/operation-scope";

it("keeps reversed manual completions from publishing in a newly selected owner", async () => {
  const a = new OperationScope();
  const b = new OperationScope();
  const validA = a.begin();
  let resolveA: (value: string) => void = () => {};
  const delayed = new Promise<string>((resolve) => {
    resolveA = resolve;
  });
  const published: string[] = [];
  const completion = delayed.then((value) => {
    if (validA()) published.push(value);
  });
  a.close();
  const validB = b.begin();
  if (validB()) published.push("B checkpoint");
  resolveA("A checkpoint and restore selection");
  await completion;
  expect(published).toEqual(["B checkpoint"]);
});

it("supersedes older reads without letting their finally clear newer busy state", () => {
  const scope = new OperationScope();
  const older = scope.begin();
  const newer = scope.begin();
  let busy = true;
  if (older()) busy = false;
  expect(busy).toBe(true);
  if (newer()) busy = false;
  expect(busy).toBe(false);
});
