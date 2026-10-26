/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILocalExtension } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IExtension, isResolverExtension } from '../../../../platform/extensions/common/extensions.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkbenchEnvironmentService } from '../../environment/common/environmentService.js';
import { areSameExtensions } from '../../../../platform/extensionManagement/common/extensionManagementUtil.js';

// --- bisect service

export const IExtensionBisectService = createDecorator<IExtensionBisectService>('IExtensionBisectService');

export interface IExtensionBisectService {

	readonly _serviceBrand: undefined;

	isDisabledByBisect(extension: IExtension): boolean;
	isActive: boolean;
	disabledCount: number;
	start(extensions: ILocalExtension[]): Promise<void>;
	next(seeingBad: boolean): Promise<{ id: string; bad: boolean } | undefined>;
	reset(): Promise<void>;
}

class BisectState {

	static fromJSON(raw: string | undefined): BisectState | undefined {
		if (!raw) {
			return undefined;
		}
		try {
			interface Raw extends BisectState { }
			const data: Raw = JSON.parse(raw);
			return new BisectState(data.extensions, data.low, data.high, data.mid);
		} catch {
			return undefined;
		}
	}

	constructor(
		readonly extensions: string[],
		readonly low: number,
		readonly high: number,
		readonly mid: number = ((low + high) / 2) | 0
	) { }
}

class ExtensionBisectService implements IExtensionBisectService {

	declare readonly _serviceBrand: undefined;

	private static readonly _storageKey = 'extensionBisectState';

	private readonly _state: BisectState | undefined;
	private readonly _disabled = new Map<string, boolean>();

	constructor(
		@ILogService logService: ILogService,
		@IStorageService private readonly _storageService: IStorageService,
		@IWorkbenchEnvironmentService private readonly _envService: IWorkbenchEnvironmentService
	) {
		const raw = _storageService.get(ExtensionBisectService._storageKey, StorageScope.APPLICATION);
		this._state = BisectState.fromJSON(raw);

		if (this._state) {
			const { mid, high } = this._state;
			for (let i = 0; i < this._state.extensions.length; i++) {
				const isDisabled = i >= mid && i < high;
				this._disabled.set(this._state.extensions[i], isDisabled);
			}
			logService.warn('extension BISECT active', [...this._disabled]);
		}
	}

	get isActive() {
		return !!this._state;
	}

	get disabledCount() {
		return this._state ? this._state.high - this._state.mid : -1;
	}

	isDisabledByBisect(extension: IExtension): boolean {
		if (!this._state) {
			// bisect isn't active
			return false;
		}
		if (isResolverExtension(extension.manifest, this._envService.remoteAuthority)) {
			// the current remote resolver extension cannot be disabled
			return false;
		}
		if (this._isEnabledInEnv(extension)) {
			// Extension enabled in env cannot be disabled
			return false;
		}
		const disabled = this._disabled.get(extension.identifier.id);
		return disabled ?? false;
	}

	private _isEnabledInEnv(extension: IExtension): boolean {
		return Array.isArray(this._envService.enableExtensions) && this._envService.enableExtensions.some(id => areSameExtensions({ id }, extension.identifier));
	}

	async start(extensions: ILocalExtension[]): Promise<void> {
		if (this._state) {
			throw new Error('invalid state');
		}
		const extensionIds = extensions.map(ext => ext.identifier.id);
		const newState = new BisectState(extensionIds, 0, extensionIds.length, 0);
		this._storageService.store(ExtensionBisectService._storageKey, JSON.stringify(newState), StorageScope.APPLICATION, StorageTarget.MACHINE);
		await this._storageService.flush();
	}

	async next(seeingBad: boolean): Promise<{ id: string; bad: boolean } | undefined> {
		if (!this._state) {
			throw new Error('invalid state');
		}
		// check if bad when all extensions are disabled
		if (seeingBad && this._state.mid === 0 && this._state.high === this._state.extensions.length) {
			return { bad: true, id: '' };
		}
		// check if there is only one left
		if (this._state.low === this._state.high - 1) {
			await this.reset();
			return { id: this._state.extensions[this._state.low], bad: seeingBad };
		}
		// the second half is disabled so if there is still bad it must be
		// in the first half
		const nextState = new BisectState(
			this._state.extensions,
			seeingBad ? this._state.low : this._state.mid,
			seeingBad ? this._state.mid : this._state.high,
		);
		this._storageService.store(ExtensionBisectService._storageKey, JSON.stringify(nextState), StorageScope.APPLICATION, StorageTarget.MACHINE);
		await this._storageService.flush();
		return undefined;
	}

	async reset(): Promise<void> {
		this._storageService.remove(ExtensionBisectService._storageKey, StorageScope.APPLICATION);
		await this._storageService.flush();
	}
}

registerSingleton(IExtensionBisectService, ExtensionBisectService, InstantiationType.Delayed);
