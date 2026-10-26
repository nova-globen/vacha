/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { dirname } from '../../../base/common/path.js';
import { ByteSize } from '../../files/common/files.js';
import { AbstractMessageLogger, ILogger, LogLevel } from '../common/log.js';

const FLUSH_DELAY = 100;
const MAX_FILE_SIZE = 5 * ByteSize.MB;

function levelName(level: LogLevel): string {
	switch (level) {
		case LogLevel.Trace: return 'trace';
		case LogLevel.Debug: return 'debug';
		case LogLevel.Info: return 'info';
		case LogLevel.Warning: return 'warning';
		case LogLevel.Error: return 'error';
		default: return '';
	}
}

function timestamp(date: Date): string {
	const pad = (value: number, length = 2) => String(value).padStart(length, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/**
 * Tond: appends log lines to a file with plain node fs, in the format the
 * native spdlog logger used (`YYYY-MM-DD HH:MM:SS.mmm [level] message`).
 * Lines are batched for {@link FLUSH_DELAY} ms; a rotating log moves to
 * `<file>.1` once it passes {@link MAX_FILE_SIZE}.
 */
export class NodeFileLogger extends AbstractMessageLogger implements ILogger {

	private pending: string[] = [];
	private flushTimer: ReturnType<typeof setTimeout> | undefined;
	private writing: Promise<void> = Promise.resolve();
	private size = 0;
	private disposed = false;

	constructor(
		private readonly filepath: string,
		private readonly rotating: boolean,
		private readonly donotUseFormatters: boolean,
		level: LogLevel,
	) {
		super();
		this.setLevel(level);
		try {
			fs.mkdirSync(dirname(filepath), { recursive: true });
			this.size = fs.statSync(filepath).size;
		} catch {
			// a new file
		}
	}

	protected log(level: LogLevel, message: string): void {
		if (this.disposed) {
			return;
		}
		this.pending.push(this.donotUseFormatters ? `${message}\n` : `${timestamp(new Date())} [${levelName(level)}] ${message}\n`);
		this.flushTimer ??= setTimeout(() => this.flushAsync(), FLUSH_DELAY);
	}

	private takePending(): string {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = undefined;
		}
		const text = this.pending.join('');
		this.pending = [];
		return text;
	}

	private rotateIfNeeded(): void {
		if (this.rotating && this.size > MAX_FILE_SIZE) {
			try {
				fs.renameSync(this.filepath, `${this.filepath}.1`);
			} catch {
				// keep appending to the current file
			}
			this.size = 0;
		}
	}

	private flushAsync(): void {
		const text = this.takePending();
		if (!text) {
			return;
		}
		this.writing = this.writing.then(async () => {
			this.rotateIfNeeded();
			try {
				await fs.promises.appendFile(this.filepath, text);
				this.size += Buffer.byteLength(text);
			} catch (error) {
				console.error(error);
			}
		});
	}

	override flush(): void {
		this.flushAsync();
	}

	override dispose(): void {
		// shutdown: write what is left synchronously so nothing is lost
		const text = this.takePending();
		if (text) {
			try {
				fs.appendFileSync(this.filepath, text);
			} catch (error) {
				console.error(error);
			}
		}
		this.disposed = true;
		super.dispose();
	}
}
