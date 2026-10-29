/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { Event } from '../../../common/event.js';
import { mapToString, setToString } from '../../../common/map.js';
import { basename } from '../../../common/path.js';
import { Promises } from '../../../node/pfs.js';
import { IStorageDatabase, IStorageItemsChangeEvent, IUpdateRequest } from '../common/storage.js';

export interface IJsonStorageDatabaseOptions {
	readonly logging?: IJsonStorageDatabaseLoggingOptions;
}

export interface IJsonStorageDatabaseLoggingOptions {
	logError?: (error: string | Error) => void;
	logTrace?: (msg: string) => void;
}

/**
 * Vacha: the storage database is a JSON file holding one object of string
 * keys and values, replacing the native @vscode/sqlite3 database.
 *
 * - The whole table is held in memory; every update rewrites the file
 *   atomically (temp file + rename), one write at a time. The `Storage`
 *   class above already batches changes, so writes are infrequent.
 * - A clean close copies the file to `<path>.backup`; a file that cannot
 *   be read falls back to that backup, then to an empty table.
 * - Each file has a single writer (the main process owns all storage), so
 *   there are no external changes to report.
 */
export class JsonStorageDatabase implements IStorageDatabase {

	static readonly IN_MEMORY_PATH = ':memory:';

	get onDidChangeItemsExternal(): Event<IStorageItemsChangeEvent> { return Event.None; } // since we are the only client, there can be no external changes

	private readonly name: string;
	private readonly logger: JsonStorageDatabaseLogger;
	private readonly isInMemory: boolean;

	private readonly whenLoaded: Promise<Map<string, string>>;
	private writing: Promise<void> = Promise.resolve();
	private lastError: string | undefined;

	constructor(
		private readonly path: string,
		options: IJsonStorageDatabaseOptions = Object.create(null)
	) {
		this.name = basename(this.path);
		this.logger = new JsonStorageDatabaseLogger(options.logging);
		this.isInMemory = path === JsonStorageDatabase.IN_MEMORY_PATH;
		this.whenLoaded = this.load();
	}

	async getItems(): Promise<Map<string, string>> {
		const items = await this.whenLoaded;

		if (this.logger.isTracing) {
			this.logger.trace(`[storage ${this.name}] getItems(): ${items.size} rows`);
		}

		return new Map(items);
	}

	async updateItems(request: IUpdateRequest): Promise<void> {
		const items = await this.whenLoaded;

		if (this.logger.isTracing) {
			this.logger.trace(`[storage ${this.name}] updateItems(): insert(${request.insert ? mapToString(request.insert) : '0'}), delete(${request.delete ? setToString(request.delete) : '0'})`);
		}

		request.insert?.forEach((value, key) => items.set(key, value));
		request.delete?.forEach(key => items.delete(key));

		return this.write(items);
	}

	async optimize(): Promise<void> {
		// nothing to compact: every write produces a fresh file
	}

	async close(recovery?: () => Map<string, string>): Promise<void> {
		this.logger.trace(`[storage ${this.name}] close()`);

		const items = await this.whenLoaded;
		await this.writing;

		if (this.isInMemory) {
			return;
		}

		// A write failed while running: persist the recovery snapshot instead
		if (this.lastError) {
			if (typeof recovery !== 'function') {
				throw new Error(`Storage has errors and no recovery option: ${this.lastError}`);
			}
			this.lastError = undefined;
			await this.write(recovery());
			if (this.lastError) {
				throw new Error(this.lastError);
			}
			return;
		}

		// Keep a backup of a good file as fallback against future corruption
		try {
			await this.write(items);
			await Promises.copy(this.path, this.toBackupPath(this.path), { preserveSymlinks: false });
		} catch (error) {
			this.logger.error(`[storage ${this.name}] backup(): ${error}`);
		}
	}

	async checkIntegrity(full: boolean): Promise<string> {
		await this.whenLoaded;

		if (this.lastError) {
			return `error (last error: ${this.lastError})`;
		}

		return this.isInMemory ? 'ok (in-memory!)' : 'ok';
	}

	private toBackupPath(path: string): string {
		return `${path}.backup`;
	}

	private async load(): Promise<Map<string, string>> {
		if (this.isInMemory) {
			return new Map();
		}

		this.logger.trace(`[storage ${this.name}] open(${this.path})`);

		for (const candidate of [this.path, this.toBackupPath(this.path)]) {
			let raw: string;
			try {
				raw = await fs.promises.readFile(candidate, 'utf8');
			} catch (error) {
				if (error.code !== 'ENOENT') {
					this.logger.error(`[storage ${this.name}] open(): Unable to read ${candidate} due to ${error}`);
				}
				continue;
			}

			try {
				const parsed: unknown = JSON.parse(raw);
				if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
					const items = new Map<string, string>();
					for (const [key, value] of Object.entries(parsed)) {
						if (typeof value === 'string') {
							items.set(key, value);
						}
					}
					return items;
				}
				this.logger.error(`[storage ${this.name}] open(): ${candidate} does not hold an object`);
			} catch (error) {
				this.logger.error(`[storage ${this.name}] open(): ${candidate} is corrupt (${error})`);
			}
		}

		// a new database (or nothing usable on disk)
		return new Map();
	}

	private write(items: Map<string, string>): Promise<void> {
		if (this.isInMemory) {
			return Promise.resolve();
		}

		// snapshot now, write in order
		const content = JSON.stringify(Object.fromEntries(items));
		this.writing = this.writing.then(async () => {
			const tempPath = `${this.path}.${process.pid}.tmp`;
			try {
				await fs.promises.writeFile(tempPath, content);
				await Promises.rename(tempPath, this.path, 1000 /* retry briefly if another program holds the file */);
			} catch (error) {
				this.lastError = `[storage ${this.name}] write(): ${error}`;
				this.logger.error(this.lastError);
				await fs.promises.unlink(tempPath).catch(() => { /* ignore */ });
			}
		});

		return this.writing;
	}
}

class JsonStorageDatabaseLogger {

	// to reduce lots of output, require an environment variable to enable tracing
	// this helps when running with --verbose normally where the storage tracing
	// might hide useful output to look at
	private static readonly VSCODE_TRACE_STORAGE = 'VSCODE_TRACE_STORAGE';

	private readonly logTrace: ((msg: string) => void) | undefined;
	private readonly logError: ((error: string | Error) => void) | undefined;

	constructor(options?: IJsonStorageDatabaseLoggingOptions) {
		if (options && typeof options.logTrace === 'function' && process.env[JsonStorageDatabaseLogger.VSCODE_TRACE_STORAGE]) {
			this.logTrace = options.logTrace;
		}

		if (options && typeof options.logError === 'function') {
			this.logError = options.logError;
		}
	}

	get isTracing(): boolean {
		return !!this.logTrace;
	}

	trace(msg: string): void {
		this.logTrace?.(msg);
	}

	error(error: string | Error): void {
		this.logError?.(error);
	}
}
