import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';

import * as cargo from './cargo';
import * as input from './input';
import * as check from './check';

export async function run(actionInput: input.Input): Promise<void> {
    const startedAt = new Date().toISOString();

    let rustcVersion = '';
    let cargoVersion = '';
    let rustfmtVersion = '';
    await exec.exec('rustc', ['-V'], {
        silent: true,
        listeners: {
            stdout: (buffer: Buffer) => (rustcVersion = buffer.toString().trim()),
        },
    });
    await cargo.exec('cargo', ['-V'], {
        silent: true,
        listeners: {
            stdout: (buffer: Buffer) => (cargoVersion = buffer.toString().trim()),
        },
    });
    await cargo.exec('rustfmt', ['-V'], {
        silent: true,
        listeners: {
            stdout: (buffer: Buffer) => (rustfmtVersion = buffer.toString().trim()),
        },
    });

    console.log(rustcVersion);
    console.log(cargoVersion);
    console.log(rustfmtVersion);

    let flags = ['--message-format=json'];
    actionInput.flags
        .filter(flag => !RegExp('--message-format=.*').test(flag))
        .forEach(flag => flags.push(flag));

    let options: string[] = [];
    actionInput.options.forEach(option => options.push(option));

    let args = ['--check'];
    actionInput.args.filter(flag => '--check' !== flag).forEach(option => options.push(option));

    let rustfmtOutput: string = '';
    try {
        core.startGroup('Executing cargo fmt (JSON output)');
        const res = await cargo.exec('fmt', [...flags, ...options, '--', ...args], {
            failOnStdErr: false,
            listeners: {
                stdout: (buffer: Buffer) => (rustfmtOutput = buffer.toString()),
            },
        });
        res.expect(e => `Rustfmt had exited with the Exit Code ${e}`);
    } finally {
        core.endGroup();
    }

    let sha = github.context.sha;
    if (github.context.payload.pull_request?.head?.sha) {
        sha = github.context.payload.pull_request.head.sha;
    }
    let runner = new check.CheckRunner();
    const output = JSON.parse(rustfmtOutput) as check.Output[];
    const res = await runner.check(output, {
        token: actionInput.token,
        name: actionInput.name,
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        head_sha: sha,
        started_at: startedAt,
        context: {
            rustc: rustcVersion,
            cargo: cargoVersion,
            rustfmt: rustfmtVersion,
        },
    });
    if (res.type == 'failure') {
        throw res.unwrap_err();
    }
}

async function main(): Promise<void> {
    try {
        const actionInput = input.get();
        await run(actionInput);
    } catch (error) {
        core.setFailed(`${error}`);
    }
}

main();