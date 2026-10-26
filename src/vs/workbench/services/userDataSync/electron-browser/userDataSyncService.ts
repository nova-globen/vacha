/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IUserDataManifest, IUserDataSyncResource, IUserDataSyncResourceConflicts, IUserDataSyncService, IUserDataSyncStore, IUserDataSyncStoreManagementService, SyncStatus, UserDataSyncStoreType } from '../../../../platform/userDataSync/common/userDataSync.js';
import { IUserDataSyncAccount, IUserDataSyncAccountService } from '../../../../platform/userDataSync/common/userDataSyncAccount.js';
import { IUserDataSyncMachine, IUserDataSyncMachinesService } from '../../../../platform/userDataSync/common/userDataSyncMachines.js';

// Tond: Settings Sync does not exist (no store, no accounts). Upstream these
// services were channel clients whose constructors immediately called into the
// shared process — which is what SPAWNED it. Permanently-idle local stands-in
// keep the injectors (settings editor sync pane, relauncher, the sync
// workbench service) dormant without any process or channel.

class TondUserDataSyncService implements IUserDataSyncService {
	declare readonly _serviceBrand: undefined;
	readonly status = SyncStatus.Uninitialized;
	readonly onDidChangeStatus = Event.None;
	readonly conflicts: IUserDataSyncResourceConflicts[] = [];
	readonly onDidChangeConflicts = Event.None;
	readonly onDidChangeLocal = Event.None;
	readonly onSyncErrors = Event.None;
	readonly lastSyncTime = undefined;
	readonly onDidChangeLastSyncTime = Event.None;
	readonly onDidResetRemote = Event.None;
	readonly onDidResetLocal = Event.None;
	createSyncTask(): Promise<never> { return Promise.reject(new Error('Sync is not available')); }
	createManualSyncTask(): Promise<never> { return Promise.reject(new Error('Sync is not available')); }
	resolveContent(): Promise<string | null> { return Promise.resolve(null); }
	accept(_syncResource: IUserDataSyncResource, _resource: URI, _content: string | null | undefined, _apply: boolean | { force: boolean }): Promise<void> { return Promise.resolve(); }
	reset(): Promise<void> { return Promise.resolve(); }
	resetRemote(): Promise<void> { return Promise.resolve(); }
	cleanUpRemoteData(): Promise<void> { return Promise.resolve(); }
	resetLocal(): Promise<void> { return Promise.resolve(); }
	hasLocalData(): Promise<boolean> { return Promise.resolve(false); }
	hasPreviouslySynced(): Promise<boolean> { return Promise.resolve(false); }
	replace(): Promise<void> { return Promise.resolve(); }
	saveRemoteActivityData(): Promise<void> { return Promise.resolve(); }
	extractActivityData(): Promise<void> { return Promise.resolve(); }
}

class TondUserDataSyncAccountService implements IUserDataSyncAccountService {
	declare readonly _serviceBrand: undefined;
	readonly onTokenFailed = Event.None;
	readonly account: IUserDataSyncAccount | undefined = undefined;
	readonly onDidChangeAccount = Event.None;
	updateAccount(): Promise<void> { return Promise.resolve(); }
}

class TondUserDataSyncMachinesService implements IUserDataSyncMachinesService {
	declare readonly _serviceBrand: undefined;
	readonly onDidChange = Event.None;
	getMachines(_manifest?: IUserDataManifest): Promise<IUserDataSyncMachine[]> { return Promise.resolve([]); }
	addCurrentMachine(_manifest?: IUserDataManifest): Promise<void> { return Promise.resolve(); }
	removeCurrentMachine(_manifest?: IUserDataManifest): Promise<void> { return Promise.resolve(); }
	renameMachine(): Promise<void> { return Promise.resolve(); }
	setEnablements(): Promise<void> { return Promise.resolve(); }
}

class TondUserDataSyncStoreManagementService implements IUserDataSyncStoreManagementService {
	declare readonly _serviceBrand: undefined;
	readonly onDidChangeUserDataSyncStore = Event.None;
	readonly userDataSyncStore: IUserDataSyncStore | undefined = undefined;
	switch(_type: UserDataSyncStoreType): Promise<void> { return Promise.resolve(); }
	getPreviousUserDataSyncStore(): Promise<IUserDataSyncStore | undefined> { return Promise.resolve(undefined); }
}

registerSingleton(IUserDataSyncService, TondUserDataSyncService, InstantiationType.Delayed);
registerSingleton(IUserDataSyncAccountService, TondUserDataSyncAccountService, InstantiationType.Delayed);
registerSingleton(IUserDataSyncMachinesService, TondUserDataSyncMachinesService, InstantiationType.Delayed);
registerSingleton(IUserDataSyncStoreManagementService, TondUserDataSyncStoreManagementService, InstantiationType.Delayed);
// IUserDataSyncResourceProviderService has no injector left and is deliberately
// no longer registered.
