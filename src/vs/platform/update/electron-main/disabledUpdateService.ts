/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { DisablementReason, IUpdateService, State } from '../common/update.js';

/**
 * Vacha checks for updates itself (contrib/vacha/browser/updateCheck) and never
 * installs them, so the platform update machinery is replaced by this
 * permanently disabled service.
 */
export class DisabledUpdateService implements IUpdateService {

	declare readonly _serviceBrand: undefined;

	readonly onStateChange = Event.None;
	readonly state: State = State.Disabled(DisablementReason.NotBuilt);

	async checkForUpdates(explicit: boolean): Promise<void> { }
	async downloadUpdate(explicit: boolean): Promise<void> { }
	async applyUpdate(): Promise<void> { }
	async quitAndInstall(): Promise<void> { }
	async isLatestVersion(): Promise<boolean | undefined> { return undefined; }
	async _applySpecificUpdate(packagePath: string): Promise<void> { }
	async setInternalOrg(internalOrg: string | undefined): Promise<void> { }
}
