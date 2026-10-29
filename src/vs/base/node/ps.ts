/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { exec } from 'child_process';
import { totalmem } from 'os';
import { FileAccess } from '../common/network.js';
import { ProcessItem } from '../common/processes.js';
import { isWindows } from '../common/platform.js';

export const JS_FILENAME_PATTERN = /[a-zA-Z-]+\.js\b/g;

export function listProcesses(rootPid: number): Promise<ProcessItem> {
	return new Promise((resolve, reject) => {
		let rootItem: ProcessItem | undefined;
		const map = new Map<number, ProcessItem>();
		const totalMemory = totalmem();

		function addToTree(pid: number, ppid: number, cmd: string, load: number, mem: number) {
			const parent = map.get(ppid);
			if (pid === rootPid || parent) {
				const item: ProcessItem = {
					name: findName(cmd),
					cmd,
					pid,
					ppid,
					load,
					mem: isWindows ? mem : (totalMemory * (mem / 100))
				};
				map.set(pid, item);

				if (pid === rootPid) {
					rootItem = item;
				}

				if (parent) {
					if (!parent.children) {
						parent.children = [];
					}
					parent.children.push(item);
					if (parent.children.length > 1) {
						parent.children = parent.children.sort((a, b) => a.pid - b.pid);
					}
				}
			}
		}

		function findName(cmd: string): string {
			const UTILITY_NETWORK_HINT = /--utility-sub-type=network/i;
			const WINDOWS_CRASH_REPORTER = /--crashes-directory/i;
			const CONPTY = /conhost\.exe.+--headless/i;
			const TYPE = /--type=([a-zA-Z-]+)/;

			// find windows crash reporter
			if (WINDOWS_CRASH_REPORTER.exec(cmd)) {
				return 'electron-crash-reporter';
			}

			// find conpty process
			if (CONPTY.exec(cmd)) {
				return 'conpty-agent';
			}

			// find "--type=xxxx"
			let matches = TYPE.exec(cmd);
			if (matches && matches.length === 2) {
				if (matches[1] === 'renderer') {
					return `window`;
				} else if (matches[1] === 'utility') {
					if (UTILITY_NETWORK_HINT.exec(cmd)) {
						return 'utility-network-service';
					}

					return 'utility-process';
				} else if (matches[1] === 'extensionHost') {
					return 'extension-host'; // normalize remote extension host type
				}
				return matches[1];
			}

			if (cmd.indexOf('node ') < 0 && cmd.indexOf('node.exe') < 0) {
				let result = ''; // find all xyz.js
				do {
					matches = JS_FILENAME_PATTERN.exec(cmd);
					if (matches) {
						result += matches + ' ';
					}
				} while (matches);

				if (result) {
					return `electron-nodejs (${result.trim()})`;
				}
			}

			return cmd;
		}

		if (process.platform === 'win32') {
			const cleanUNCPrefix = (value: string): string => {
				if (value.indexOf('\\\\?\\') === 0) {
					return value.substring(4);
				} else if (value.indexOf('\\??\\') === 0) {
					return value.substring(4);
				} else if (value.indexOf('"\\\\?\\') === 0) {
					return '"' + value.substring(5);
				} else if (value.indexOf('"\\??\\') === 0) {
					return '"' + value.substring(5);
				} else {
					return value;
				}
			};

			// Vacha: read the process table through CIM instead of the native
			// windows-process-tree module (no CPU load figures; memory is the working set)
			const script = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,WorkingSetSize | ConvertTo-Json -Compress';
			exec(`powershell.exe -NoProfile -NonInteractive -Command "${script}"`, { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
				if (err) {
					reject(err);
					return;
				}

				let rows: { ProcessId: number; ParentProcessId: number; CommandLine: string | null; WorkingSetSize: number }[];
				try {
					rows = JSON.parse(stdout);
				} catch (error) {
					reject(error);
					return;
				}

				const processItems: Map<number, ProcessItem> = new Map();
				for (const row of rows) {
					const commandLine = cleanUNCPrefix(row.CommandLine || '');
					processItems.set(row.ProcessId, {
						name: findName(commandLine),
						cmd: commandLine,
						pid: row.ProcessId,
						ppid: row.ParentProcessId,
						load: 0,
						mem: row.WorkingSetSize || 0
					});
				}

				rootItem = processItems.get(rootPid);
				if (!rootItem) {
					reject(new Error(`Root process ${rootPid} not found`));
					return;
				}

				// keep only the root's descendants; a reused pid can make the
				// parent links cyclic, so each process is visited once
				const children = new Map<number, ProcessItem[]>();
				processItems.forEach(item => {
					const list = children.get(item.ppid) ?? [];
					list.push(item);
					children.set(item.ppid, list);
				});
				const visited = new Set<number>();
				const attach = (parent: ProcessItem) => {
					visited.add(parent.pid);
					const list = children.get(parent.pid)?.filter(child => !visited.has(child.pid));
					if (list?.length) {
						parent.children = list.sort((a, b) => a.pid - b.pid);
						list.forEach(attach);
					}
				};
				attach(rootItem);
				resolve(rootItem);
			});
		}

		// OS X & Linux
		else {
			function calculateLinuxCpuUsage() {

				// Flatten rootItem to get a list of all VSCode processes
				let processes = [rootItem];
				const pids: number[] = [];
				while (processes.length) {
					const process = processes.shift();
					if (process) {
						pids.push(process.pid);
						if (process.children) {
							processes = processes.concat(process.children);
						}
					}
				}

				// The cpu usage value reported on Linux is the average over the process lifetime,
				// recalculate the usage over a one second interval
				// JSON.stringify is needed to escape spaces, https://github.com/nodejs/node/issues/6803
				let cmd = JSON.stringify(FileAccess.asFileUri('vs/base/node/cpuUsage.sh').fsPath);
				cmd += ' ' + pids.join(' ');

				exec(cmd, {}, (err, stdout, stderr) => {
					if (err || stderr) {
						reject(err || new Error(stderr.toString()));
					} else {
						const cpuUsage = stdout.toString().split('\n');
						for (let i = 0; i < pids.length; i++) {
							const processInfo = map.get(pids[i])!;
							processInfo.load = parseFloat(cpuUsage[i]);
						}

						if (!rootItem) {
							reject(new Error(`Root process ${rootPid} not found`));
							return;
						}

						resolve(rootItem);
					}
				});
			}

			exec('which ps', {}, (err, stdout, stderr) => {
				if (err || stderr) {
					if (process.platform !== 'linux') {
						reject(err || new Error(stderr.toString()));
					} else {
						const cmd = JSON.stringify(FileAccess.asFileUri('vs/base/node/ps.sh').fsPath);
						exec(cmd, {}, (err, stdout, stderr) => {
							if (err || stderr) {
								reject(err || new Error(stderr.toString()));
							} else {
								parsePsOutput(stdout, addToTree);
								calculateLinuxCpuUsage();
							}
						});
					}
				} else {
					const ps = stdout.toString().trim();
					const args = '-ax -o pid=,ppid=,pcpu=,pmem=,command=';

					// Set numeric locale to ensure '.' is used as the decimal separator
					exec(`${ps} ${args}`, { maxBuffer: 1000 * 1024, env: { LC_NUMERIC: 'en_US.UTF-8' } }, (err, stdout, stderr) => {
						// Silently ignoring the screen size is bogus error. See https://github.com/microsoft/vscode/issues/98590
						if (err || (stderr && !stderr.includes('screen size is bogus'))) {
							reject(err || new Error(stderr.toString()));
						} else {
							parsePsOutput(stdout, addToTree);

							if (process.platform === 'linux') {
								calculateLinuxCpuUsage();
							} else {
								if (!rootItem) {
									reject(new Error(`Root process ${rootPid} not found`));
								} else {
									resolve(rootItem);
								}
							}
						}
					});
				}
			});
		}
	});
}

function parsePsOutput(stdout: string, addToTree: (pid: number, ppid: number, cmd: string, load: number, mem: number) => void): void {
	const PID_CMD = /^\s*([0-9]+)\s+([0-9]+)\s+([0-9]+\.[0-9]+)\s+([0-9]+\.[0-9]+)\s+(.+)$/;
	const lines = stdout.toString().split('\n');
	for (const line of lines) {
		const matches = PID_CMD.exec(line.trim());
		if (matches && matches.length === 6) {
			addToTree(parseInt(matches[1]), parseInt(matches[2]), matches[5], parseFloat(matches[3]), parseFloat(matches[4]));
		}
	}
}
