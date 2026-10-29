/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionInstallLocation, IExtensionManagementServer, IExtensionManagementServerService } from '../common/extensionManagement.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IExtension } from '../../../../platform/extensions/common/extensions.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

export class ExtensionManagementServerService extends Disposable implements IExtensionManagementServerService {

	declare readonly _serviceBrand: undefined;

	// Vacha: no extension management exists — nothing can be installed, and the
	// grammars/themes are scanned in the renderer. Registering the shared
	// process backed local server was the last thing that SPAWNED the shared
	// process on boot (its channel client subscribes to install events in its
	// constructor and `ExtensionsWorkbenchService` queries installed extensions
	// at startup). Running server-less is the web build's supported shape; every
	// consumer null-checks.
	readonly localExtensionManagementServer: IExtensionManagementServer | null = null;
	readonly remoteExtensionManagementServer: IExtensionManagementServer | null = null;
	readonly webExtensionManagementServer: IExtensionManagementServer | null = null;

	constructor() {
		super();
	}

	getExtensionManagementServer(extension: IExtension): IExtensionManagementServer {
		throw new Error(`Invalid Extension ${extension.location}`);
	}

	getExtensionInstallLocation(extension: IExtension): ExtensionInstallLocation | null {
		const server = this.getExtensionManagementServer(extension);
		return server === this.remoteExtensionManagementServer ? ExtensionInstallLocation.Remote : ExtensionInstallLocation.Local;
	}
}

registerSingleton(IExtensionManagementServerService, ExtensionManagementServerService, InstantiationType.Delayed);
