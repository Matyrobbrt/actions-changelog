import { context, getOctokit } from "@actions/github";
import { setOutput, getInput } from "@actions/core";
import { exec } from "@actions/exec";
import { which } from "@actions/io";

run();

async function run() {
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const branch = getInput("branch")
    ? getInput("branch")
    : context.ref.split("/").pop();
  const token = getInput("token") ? getInput("token") : process.env['GITHUB_TOKEN'];

  // Request the last completed workflow run for this branch
  let request = await getOctokit(token).rest.actions.listWorkflowRuns({
    owner: owner,
    repo: repo,
    workflow_id: getInput("workflow_id"),
    branch: branch,
    per_page: 1,
    status: "success"
  });

  var changelog;

  let runs = await request.data.workflow_runs;
  if (runs.length == 0) {
    changelog = "Inital release";
  } else if (runs.length > 1) {
    throw new Error("Return more runs than expected!");
  } else {
    changelog = await generateChangelogSinceRun(
      runs[0],
      getInput("commit_regex")
    );
  }

  console.log(changelog);
  setOutput("changelog", changelog);
}

async function generateChangelogSinceRun(lastRun, comRegex) {
  let previousCommit = lastRun.head_commit.id;
  let releaseCommit = context.sha;

  if (!previousCommit) {
    throw new Error("Failed to get previous commit");
  }

  console.log({
    previousCommit,
    releaseCommit,
  });

  if (previousCommit == releaseCommit) {
    console.log("Previous commit is equal to current commit");
    return "No changes";
  }

  let log = await gitLog(previousCommit, releaseCommit);
  if (comRegex) {
    let reg = new RegExp(comRegex);
    return log
      .split("\n")
      .filter((val) => !reg.test(val.substr(2))) // We start at index 2 to ignore the "-" char
      .join("\n");
  }
  return log;
}

async function gitLog(previousCommit, releaseCommit) {
  const log = await git([
    "log",
    "--pretty=- %s (%an, %(trailers:key=Co-authored-by,valueonly,separator=%x2C ))", 
    `${previousCommit}..${releaseCommit}`,
  ]);

  return log.replace(/ <.+?>/g, "").replace(/, \)/g, ")");
}

async function git(args) {
  let output = "";
  let exitCode = await exec(await which("git", true), args, {
    listeners: {
      stdout: (data) => {
        output += data.toString();
      },
    },
  });

  if (exitCode != 0) {
    throw new Error("Git command failed with exit code: " + exitCode);
  }

  console.log("Git command finished with exit code:" + exitCode);

  return output;
}
